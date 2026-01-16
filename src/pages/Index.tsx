import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, Download, Loader2, ImageIcon, Trash2, MousePointer, Info } from "lucide-react";
import { 
  loadSAMModel, 
  prepareImageEmbeddings, 
  segmentAtPoint, 
  applyMaskToImage,
  createCanvasFromImage 
} from "@/lib/segmentAnything";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";

const Index = () => {
  const [originalImage, setOriginalImage] = useState<string | null>(null);
  const [processedImage, setProcessedImage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);
  const [fileName, setFileName] = useState<string>("");
  const [imageDimensions, setImageDimensions] = useState<{ width: number; height: number } | null>(null);
  const [isModelReady, setIsModelReady] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
    setIsModelReady(false);

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
        title: "Ready!",
        description: "Click on any person in the image to isolate them",
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

  const handleImageClick = useCallback(async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!isModelReady || !imageRef.current || !canvasRef.current || !imageDimensions) return;

    const rect = imageRef.current.getBoundingClientRect();
    const scaleX = imageDimensions.width / rect.width;
    const scaleY = imageDimensions.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    setIsProcessing(true);
    try {
      const mask = await segmentAtPoint(x, y, imageDimensions.width, imageDimensions.height);
      if (mask) {
        const resultUrl = applyMaskToImage(canvasRef.current, mask);
        setProcessedImage(resultUrl);
        toast({
          title: "Subject isolated!",
          description: "Click elsewhere to select a different person",
        });
      }
    } catch (error) {
      console.error(error);
      toast({
        title: "Error",
        description: "Failed to segment. Try clicking a different area.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  }, [isModelReady, imageDimensions, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

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
    setOriginalImage(null);
    setProcessedImage(null);
    setFileName("");
    setImageDimensions(null);
    setIsModelReady(false);
    canvasRef.current = null;
  }, []);

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
            <label className="flex flex-col items-center justify-center py-20 px-6 cursor-pointer">
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Upload className="w-10 h-10 text-primary" />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                Drop your image here
              </h3>
              <p className="text-muted-foreground mb-4">or click to browse</p>
              <Button variant="outline" size="lg">
                <ImageIcon className="w-4 h-4 mr-2" />
                Select Image
              </Button>
              <input
                type="file"
                accept="image/*"
                onChange={handleInputChange}
                className="hidden"
              />
            </label>
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
            {/* Instructions */}
            {isModelReady && (
              <Card className="p-4 bg-primary/5 border-primary/20">
                <div className="flex items-center gap-3">
                  <MousePointer className="w-5 h-5 text-primary" />
                  <p className="text-sm text-foreground">
                    <strong>Click on any person</strong> in the original image to isolate them. 
                    The selected person will appear with a transparent background.
                  </p>
                </div>
              </Card>
            )}

            <div className="grid md:grid-cols-2 gap-6">
              {/* Original */}
              <Card className="overflow-hidden bg-card">
                <div className="p-4 border-b border-border">
                  <h3 className="font-semibold text-foreground">Original - Click to Select</h3>
                </div>
                <div className="p-4 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImNoZWNrZXJib2FyZCIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiBwYXR0ZXJuVW5pdHM9InVzZXJTcGFjZU9uVXNlIj48cmVjdCB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiNmMGYwZjAiLz48cmVjdCB4PSIxMCIgeT0iMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjZmZmZmZmIi8+PHJlY3QgeD0iMCIgeT0iMTAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iI2ZmZmZmZiIvPjxyZWN0IHg9IjEwIiB5PSIxMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjZjBmMGYwIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2NoZWNrZXJib2FyZCkiLz48L3N2Zz4=')]">
                  <img
                    ref={imageRef}
                    src={originalImage}
                    alt="Original"
                    className={`w-full h-auto max-h-96 object-contain rounded ${isModelReady ? 'cursor-crosshair' : 'cursor-wait'}`}
                    onClick={handleImageClick}
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
