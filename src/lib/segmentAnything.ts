import { SamModel, AutoProcessor, RawImage, Tensor } from '@huggingface/transformers';

let model: any = null;
let processor: any = null;
let imageEmbeddings: any = null;
let currentImageInput: any = null;

export interface SegmentResult {
  mask: ImageData;
  score: number;
  bounds: { x: number; y: number; width: number; height: number };
}

export const loadSAMModel = async (onProgress?: (progress: number) => void): Promise<void> => {
  if (model && processor) return;

  console.log('Loading SAM model...');
  
  model = await SamModel.from_pretrained('Xenova/slimsam-77-uniform', {
    dtype: 'fp16',
    device: 'webgpu',
    progress_callback: (progress: any) => {
      if (progress.status === 'progress' && onProgress) {
        onProgress(Math.round(progress.progress));
      }
    }
  });

  processor = await AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform');
  console.log('SAM model loaded successfully');
};

export const prepareImageEmbeddings = async (imageUrl: string): Promise<{ width: number; height: number }> => {
  if (!model || !processor) {
    throw new Error('Model not loaded. Call loadSAMModel first.');
  }

  console.log('Preparing image embeddings...');
  const image = await RawImage.fromURL(imageUrl);
  currentImageInput = await processor(image);
  imageEmbeddings = await model.get_image_embeddings(currentImageInput);
  
  console.log('Image embeddings ready');
  return { width: image.width, height: image.height };
};

export const segmentAtPoint = async (
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number
): Promise<Uint8Array | null> => {
  if (!model || !processor || !imageEmbeddings || !currentImageInput) {
    throw new Error('Image not prepared. Call prepareImageEmbeddings first.');
  }

  // Normalize coordinates to image dimensions
  const input_points = new Tensor('float32', [x, y], [1, 1, 2]);
  const input_labels = new Tensor('int64', [1n], [1, 1]);

  const outputs = await model({
    ...imageEmbeddings,
    input_points,
    input_labels,
  });

  const masks = await processor.post_process_masks(
    outputs.pred_masks,
    currentImageInput.original_sizes,
    currentImageInput.reshaped_input_sizes
  );

  // Get the best mask (highest score)
  const scores = outputs.iou_scores.data;
  let bestMaskIndex = 0;
  let bestScore = scores[0];
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] > bestScore) {
      bestScore = scores[i];
      bestMaskIndex = i;
    }
  }

  const maskData = masks[0][0][bestMaskIndex].data;
  return new Uint8Array(maskData);
};

export const applyMaskToImage = (
  originalCanvas: HTMLCanvasElement,
  mask: Uint8Array
): string => {
  const width = originalCanvas.width;
  const height = originalCanvas.height;
  
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputCtx = outputCanvas.getContext('2d')!;
  
  // Draw original image
  outputCtx.drawImage(originalCanvas, 0, 0);
  
  // Get image data and apply mask
  const imageData = outputCtx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  for (let i = 0; i < mask.length; i++) {
    // Set alpha channel based on mask (mask value 1 = visible, 0 = transparent)
    data[i * 4 + 3] = mask[i] ? 255 : 0;
  }
  
  outputCtx.putImageData(imageData, 0, 0);
  return outputCanvas.toDataURL('image/png');
};

export const createCanvasFromImage = (img: HTMLImageElement): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return canvas;
};

export const autoDetectSubjects = async (
  imageWidth: number,
  imageHeight: number
): Promise<{ x: number; y: number }[]> => {
  // Generate a grid of points to sample for potential subjects
  const points: { x: number; y: number }[] = [];
  const gridSize = 5;
  
  for (let row = 1; row < gridSize; row++) {
    for (let col = 1; col < gridSize; col++) {
      points.push({
        x: (imageWidth * col) / gridSize,
        y: (imageHeight * row) / gridSize
      });
    }
  }
  
  return points;
};
