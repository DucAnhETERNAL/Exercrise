/**
 * Vercel Blob Storage Service
 * Uses @vercel/blob SDK for client-side uploads
 * 
 * ⚠️ NOTE: Requires BLOB_READ_WRITE_TOKEN from Vercel environment variables
 * For client-side uploads, you need to expose the token (not recommended for production)
 * Better approach: Use a server-side API route to handle uploads securely
 */

import { put } from '@vercel/blob';

// Vercel Blob Configuration from environment variables
const BLOB_CONFIG = {
  token: (process.env as any).BLOB_READ_WRITE_TOKEN || '',
};

/**
 * Uploads JSON content to Vercel Blob and returns the full blob URL
 */
export const uploadToBlob = async (content: object, filename: string): Promise<string> => {
  if (!BLOB_CONFIG.token) {
    throw new Error('BLOB_READ_WRITE_TOKEN is not configured. Please check your environment variables.');
  }

  try {
    // Convert content to JSON string
    const contentStr = JSON.stringify(content);
    const contentBlob = new Blob([contentStr], { type: 'application/json' });
    
    // Upload to Vercel Blob
    // Use exercises/ prefix for organization
    const blobPath = `exercises/${filename}`;
    
    const blob = await put(blobPath, contentBlob, {
      access: 'public',
      token: BLOB_CONFIG.token,
      contentType: 'application/json',
    });
    
    // Return the full blob URL for loading later
    // Format: https://[hash].public.blob.vercel-storage.com/exercises/[filename]
    return blob.url;
  } catch (error: any) {
    throw new Error(`Failed to upload to Vercel Blob: ${error.message || 'Unknown error'}`);
  }
};

/**
 * Loads JSON content from Vercel Blob using the blob URL
 * Vercel Blob URLs are public, so we can fetch directly
 */
export const loadFromBlob = async (blobUrl: string, retries: number = 3): Promise<any> => {
  // blobUrl should be the full URL from Vercel Blob
  // Format: https://[hash].public.blob.vercel-storage.com/exercises/[filename]
  const url = blobUrl;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
    });
    
    if (!response.ok) {
      if (retries > 0 && (response.status === 502 || response.status === 503)) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return loadFromBlob(blobUrl, retries - 1);
      }
      
      if (response.status === 404) {
        throw new Error('Không thể tải file. File có thể đã bị xóa hoặc không tồn tại.');
      }
      
      throw new Error(`Không thể tải file: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error: any) {
    if (retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return loadFromBlob(blobUrl, retries - 1);
    }
    
    throw new Error(`Không thể tải file từ Vercel Blob: ${error.message || 'Lỗi không xác định'}`);
  }
};

