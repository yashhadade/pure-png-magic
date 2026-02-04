export const applyMaskToImage = (
  imageUrl: string,
  maskCanvas: HTMLCanvasElement
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      // Draw original image
      ctx.drawImage(img, 0, 0);

      // Get mask data
      const maskCtx = maskCanvas.getContext('2d');
      if (!maskCtx) {
        reject(new Error('Could not get mask canvas context'));
        return;
      }

      // Scale mask to match image dimensions
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.naturalWidth;
      tempCanvas.height = img.naturalHeight;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) {
        reject(new Error('Could not get temp canvas context'));
        return;
      }
      tempCtx.drawImage(maskCanvas, 0, 0, tempCanvas.width, tempCanvas.height);

      const maskData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Apply mask with better precision - white pixels in mask = keep, black = remove
      // Use grayscale value from mask (all RGB channels should be same in grayscale)
      for (let i = 0; i < maskData.data.length; i += 4) {
        // Get grayscale value (average of RGB or just use red channel)
        const maskValue = maskData.data[i]; // Red channel (grayscale mask)
        // Directly map mask value to alpha (0-255)
        imageData.data[i + 3] = maskValue; // Set alpha channel
      }

      ctx.putImageData(imageData, 0, 0);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob'));
          }
        },
        'image/png',
        1.0
      );
    };
    img.onerror = reject;
    img.src = imageUrl;
  });
};
