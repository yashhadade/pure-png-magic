import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, Download, Loader2, ImageIcon, Trash2, Paintbrush, Eraser, X, Check } from "lucide-react";
import { removeBackground, loadImage } from "@/lib/removeBackground";
import { applyMaskToImage } from "@/lib/preciseCut";
import { useToast } from "@/hooks/use-toast";
import { Slider } from "@/components/ui/slider";

const Index = () => {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [fileName, setFileName] = useState<string>("");
  const [editMode, setEditMode] = useState<"auto" | "manual">("auto");
  const [brushMode, setBrushMode] = useState<"keep" | "remove">("keep");
  const [maskMode, setMaskMode] = useState<"keep-all" | "remove-all">("keep-all");
  const [brushSize, setBrushSize] = useState([20]);
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid file",
        description: "Please select an image file",
        variant: "destructive",
      });
      return;
    }

    setFileName(file.name.replace(/\.[^/.]+$/, ""));
    const url = URL.createObjectURL(file);
    setOriginalImage(url);
    setProcessedImage(null);
    setEditMode("auto");

    // Load model and prepare image
    setIsLoadingModel(true);
    setModelProgress(0);
    
    try {
      await loadSAMModel((progress) => setModelProgress(progress));
      
      // Wait for image to load
      const img = new Image();
      img.src = url;
      await new Promise((resolve) => { img.onload = resolve; });
      
      // Create canvas from image
      canvasRef.current = createCanvasFromImage(img);
      
      // Prepare embeddings
      const dims = await prepareImageEmbeddings(url);
      setImageDimensions(dims);
      setIsModelReady(true);
      
      toast({
        title: "Success!",
        description: "Background removed successfully. Switch to Manual mode for precise editing.",
      });
    } catch (error) {
      console.error(error);
      toast({
        title: "Error",
        description: "Failed to load model. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingModel(false);
    }
  }, [toast]);

  // Initialize mask canvas when image loads
  useEffect(() => {
    if (originalImage && imageRef.current && maskCanvasRef.current && canvasRef.current && editMode === "manual") {
      const img = imageRef.current;
      const maskCanvas = maskCanvasRef.current;
      const drawCanvas = canvasRef.current;
      
      const updateCanvasSize = () => {
        const rect = img.getBoundingClientRect();
        drawCanvas.width = rect.width;
        drawCanvas.height = rect.height;
        drawCanvas.style.width = `${rect.width}px`;
        drawCanvas.style.height = `${rect.height}px`;
        
        // Use natural image size for mask (full resolution)
        maskCanvas.width = img.naturalWidth;
        maskCanvas.height = img.naturalHeight;
        
        // Initialize mask based on mode
        const maskCtx = maskCanvas.getContext('2d');
        if (maskCtx) {
          maskCtx.fillStyle = maskMode === "keep-all" ? 'white' : 'black';
          maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
        }
        
        // Clear draw canvas
        const drawCtx = drawCanvas.getContext('2d');
        if (drawCtx) {
          drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        }
      };
      
      if (img.complete) {
        updateCanvasSize();
      } else {
        img.onload = updateCanvasSize;
      }
      
      // Update on window resize
      window.addEventListener('resize', updateCanvasSize);
      return () => window.removeEventListener('resize', updateCanvasSize);
    }
  }, [originalImage, editMode, maskMode]);

  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const drawOnMask = (x: number, y: number, isFirstPoint: boolean = false) => {
    const maskCanvas = maskCanvasRef.current;
    const drawCanvas = canvasRef.current;
    const img = imageRef.current;
    if (!maskCanvas || !drawCanvas || !img) return;
    
    // Scale coordinates from display size to natural size
    const rect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    
    const maskX = x * scaleX;
    const maskY = y * scaleY;
    const maskBrushSize = brushSize[0] * scaleX;
    
    // Draw on mask canvas (full resolution)
    const maskCtx = maskCanvas.getContext('2d');
    if (maskCtx) {
      maskCtx.globalCompositeOperation = brushMode === "keep" ? "source-over" : "destination-out";
      maskCtx.fillStyle = brushMode === "keep" ? "white" : "black";
      maskCtx.strokeStyle = brushMode === "keep" ? "white" : "black";
      maskCtx.lineWidth = maskBrushSize;
      maskCtx.lineCap = 'round';
      maskCtx.lineJoin = 'round';
      
      if (isFirstPoint || !lastPointRef.current) {
        maskCtx.beginPath();
        maskCtx.arc(maskX, maskY, maskBrushSize / 2, 0, Math.PI * 2);
        maskCtx.fill();
      } else {
        // Draw smooth line between points
        maskCtx.beginPath();
        maskCtx.moveTo(lastPointRef.current.x * scaleX, lastPointRef.current.y * scaleY);
        maskCtx.lineTo(maskX, maskY);
        maskCtx.stroke();
        // Fill circle at current point
        maskCtx.beginPath();
        maskCtx.arc(maskX, maskY, maskBrushSize / 2, 0, Math.PI * 2);
        maskCtx.fill();
      }
    }
    
    // Draw preview on display canvas
    const drawCtx = drawCanvas.getContext('2d');
    if (drawCtx) {
      drawCtx.globalCompositeOperation = brushMode === "keep" ? "source-over" : "destination-out";
      const previewColor = brushMode === "keep" ? "rgba(34, 197, 94, 0.4)" : "rgba(239, 68, 68, 0.4)";
      drawCtx.fillStyle = previewColor;
      drawCtx.strokeStyle = previewColor;
      drawCtx.lineWidth = brushSize[0];
      drawCtx.lineCap = 'round';
      drawCtx.lineJoin = 'round';
      
      if (isFirstPoint || !lastPointRef.current) {
        drawCtx.beginPath();
        drawCtx.arc(x, y, brushSize[0] / 2, 0, Math.PI * 2);
        drawCtx.fill();
      } else {
        // Draw smooth line between points
        drawCtx.beginPath();
        drawCtx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
        drawCtx.lineTo(x, y);
        drawCtx.stroke();
        // Fill circle at current point
        drawCtx.beginPath();
        drawCtx.arc(x, y, brushSize[0] / 2, 0, Math.PI * 2);
        drawCtx.fill();
      }
    }
    
    // Store current point for next draw
    lastPointRef.current = { x, y };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (editMode !== "manual") return;
    setIsDrawing(true);
    lastPointRef.current = null; // Reset for new stroke
    const coords = getCoordinates(e);
    if (coords) {
      drawOnMask(coords.x, coords.y, true);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (editMode !== "manual" || !isDrawing) return;
    const coords = getCoordinates(e);
    if (coords) {
      drawOnMask(coords.x, coords.y, false);
    }
  };

  const handleCanvasMouseUp = () => {
    setIsDrawing(false);
    lastPointRef.current = null;
  };

  const handleApplyManualMask = useCallback(async () => {
    if (!originalImage || !maskCanvasRef.current) return;
    
    setIsProcessing(true);
    try {
      const resultBlob = await applyMaskToImage(originalImage, maskCanvasRef.current);
      const resultUrl = URL.createObjectURL(resultBlob);
      setProcessedImage(resultUrl);
      toast({
        title: "Success!",
        description: "Mask applied successfully",
      });
    } catch (error) {
      console.error(error);
      toast({
        title: "Error",
        description: "Failed to apply mask. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  }, [originalImage, toast]);

  const handleClearMask = () => {
    const maskCanvas = maskCanvasRef.current;
    const drawCanvas = canvasRef.current;
    if (!maskCanvas) return;
    
    const ctx = maskCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = maskMode === "keep-all" ? 'white' : 'black';
      ctx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    }
    
    // Clear preview canvas
    if (drawCanvas) {
      const drawCtx = drawCanvas.getContext('2d');
      if (drawCtx) {
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      }
    }
    
    lastPointRef.current = null;
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleFileInputClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleDownload = useCallback(() => {
    if (!processedImage) return;
    const a = document.createElement("a");
    a.href = processedImage;
    a.download = `${fileName || "image"}-isolated.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [processedImage, fileName]);

  const handleReset = useCallback(() => {
    if (originalImage) URL.revokeObjectURL(originalImage);
    if (processedImage) URL.revokeObjectURL(processedImage);
    setOriginalImage(null);
    setProcessedImage(null);
    setFileName("");
    setEditMode("auto");
    setBrushMode("keep");
  }, [originalImage, processedImage]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-3">
            Subject Isolator
          </h1>
          <p className="text-muted-foreground text-lg">
            Click on any person to isolate them from group photos. 100% free, runs in your browser.
          </p>
        </div>

        {/* Upload Area */}
        {!originalImage && (
          <Card
            className="border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 transition-colors cursor-pointer bg-card/50 backdrop-blur"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <div className="flex flex-col items-center justify-center py-20 px-6">
              <label 
                htmlFor="file-upload"
                className="flex flex-col items-center justify-center cursor-pointer mb-4"
              >
                <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Upload className="w-10 h-10 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  Drop your image here
                </h3>
                <p className="text-muted-foreground">or click to browse</p>
              </label>
              <Button 
                variant="outline" 
                size="lg"
                onClick={handleFileInputClick}
                type="button"
              >
                <ImageIcon className="w-4 h-4 mr-2" />
                Select Image
              </Button>
              <input
                id="file-upload"
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleInputChange}
                className="hidden"
              />
            </div>
          </Card>
        )}

        {/* Loading Model */}
        {isLoadingModel && (
          <Card className="p-8 bg-card">
            <div className="flex flex-col items-center justify-center space-y-4">
              <Loader2 className="w-12 h-12 text-primary animate-spin" />
              <h3 className="text-lg font-semibold">Loading AI Model...</h3>
              <div className="w-full max-w-md">
                <Progress value={modelProgress} className="h-2" />
              </div>
              <p className="text-sm text-muted-foreground">
                {modelProgress}% - First time may take a moment to download (~50MB)
              </p>
            </div>
          </Card>
        )}

        {/* Image Preview */}
        {originalImage && !isLoadingModel && (
          <div className="space-y-6">
            {/* Mode Toggle */}
            <div className="flex justify-center gap-2">
              <Button
                variant={editMode === "auto" ? "default" : "outline"}
                onClick={() => setEditMode("auto")}
                size="sm"
              >
                Auto Remove
              </Button>
              <Button
                variant={editMode === "manual" ? "default" : "outline"}
                onClick={() => setEditMode("manual")}
                size="sm"
              >
                Manual Selection
              </Button>
            </div>

            {/* Manual Editing Tools */}
            {editMode === "manual" && (
              <Card className="p-4">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2 justify-center">
                    <span className="text-sm text-muted-foreground">Start with:</span>
                    <Button
                      variant={maskMode === "keep-all" ? "default" : "outline"}
                      onClick={() => {
                        setMaskMode("keep-all");
                        handleClearMask();
                      }}
                      size="sm"
                    >
                      Keep All
                    </Button>
                    <Button
                      variant={maskMode === "remove-all" ? "default" : "outline"}
                      onClick={() => {
                        setMaskMode("remove-all");
                        handleClearMask();
                      }}
                      size="sm"
                    >
                      Remove All
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 justify-center">
                    <div className="flex items-center gap-2">
                      <Button
                        variant={brushMode === "keep" ? "default" : "outline"}
                        onClick={() => setBrushMode("keep")}
                        size="sm"
                      >
                        <Paintbrush className="w-4 h-4 mr-2" />
                        Keep
                      </Button>
                      <Button
                        variant={brushMode === "remove" ? "default" : "outline"}
                        onClick={() => setBrushMode("remove")}
                        size="sm"
                      >
                        <Eraser className="w-4 h-4 mr-2" />
                        Remove
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 min-w-[200px]">
                      <span className="text-sm text-muted-foreground">Brush Size:</span>
                      <Slider
                        value={brushSize}
                        onValueChange={setBrushSize}
                        min={5}
                        max={100}
                        step={5}
                        className="w-32"
                      />
                      <span className="text-sm text-muted-foreground w-12">{brushSize[0]}px</span>
                    </div>
                    <Button
                      variant="outline"
                      onClick={handleClearMask}
                      size="sm"
                    >
                      <X className="w-4 h-4 mr-2" />
                      Reset
                    </Button>
                    <Button
                      onClick={handleApplyManualMask}
                      disabled={isProcessing}
                      size="sm"
                    >
                      <Check className="w-4 h-4 mr-2" />
                      Apply Mask
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            <div className="grid md:grid-cols-2 gap-6">
              {/* Original */}
              <Card className="overflow-hidden bg-card">
                <div className="p-4 border-b border-border">
                  <h3 className="font-semibold text-foreground">
                    {editMode === "manual" ? "Draw on Image" : "Original"}
                  </h3>
                </div>
                <div className="relative p-4 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImNoZWNrZXJib2FyZCIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cmVjdCB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiNmMGYwZjAiLz48cmVjdCB4PSIxMCIgeT0iMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjZmZmZmZmIi8+PHJlY3QgeD0iMCIgeT0iMTAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iI2ZmZmZmZiIvPjxyZWN0IHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjZjBmMGYwIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2NoZWNrZXJib2FyZCkiLz48L3N2Zz4=')]">
                  <div className="relative inline-block w-full">
                    <img
                      ref={imageRef}
                      src={originalImage}
                      alt="Original"
                      className="w-full h-auto max-h-96 object-contain rounded"
                    />
                    {editMode === "manual" && (
                      <canvas
                        ref={canvasRef}
                        className="absolute top-0 left-0 rounded cursor-crosshair"
                        style={{ 
                          pointerEvents: 'auto',
                          imageRendering: 'pixelated'
                        }}
                        onMouseDown={handleCanvasMouseDown}
                        onMouseMove={handleCanvasMouseMove}
                        onMouseUp={handleCanvasMouseUp}
                        onMouseLeave={handleCanvasMouseUp}
                      />
                    )}
                  </div>
                  <canvas
                    ref={maskCanvasRef}
                    className="hidden"
                  />
                  {isProcessing && (
                    <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                      <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    </div>
                  )}
                </div>
              </Card>

              {/* Processed */}
              <Card className="overflow-hidden bg-card">
                <div className="p-4 border-b border-border">
                  <h3 className="font-semibold text-foreground">Isolated Subject</h3>
                </div>
                <div className="p-4 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImNoZWNrZXJib2FyZCIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cmVjdCB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiNmMGYwZjAiLz48cmVjdCB4PSIxMCIgeT0iMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjZmZmZmZmIi8+PHJlY3QgeD0iMCIgeT0iMTAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iI2ZmZmZmZiIvPjxyZWN0IHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjZjBmMGYwIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2NoZWNrZXJib2FyZCkiLz48L3N2Zz4=')]">
                  {processedImage ? (
                    <img
                      src={processedImage}
                      alt="Isolated"
                      className="w-full h-auto max-h-96 object-contain rounded"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-96 text-muted-foreground">
                      <Info className="w-8 h-8 mb-2" />
                      <p>Click on a person in the original image</p>
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap justify-center gap-4">
              <Button
                onClick={handleDownload}
                disabled={!processedImage || isProcessing}
                size="lg"
                className="min-w-40"
              >
                <Download className="w-4 h-4 mr-2" />
                Download PNG
              </Button>
              <Button
                onClick={handleReset}
                variant="outline"
                size="lg"
                className="min-w-40"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Try Another Image
              </Button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center mt-12 text-sm text-muted-foreground">
          <p>Your images are processed locally in your browser. Nothing is uploaded to any server.</p>
        </div>
      </div>
    </div>
  );
};

export default Index;
