/**
 * Cloudflare R2 Storage Service
 * Uses S3-compatible API with AWS Signature V4
 * 
 * ⚠️ WARNING: This implementation exposes R2 credentials to the client.
 * For production, consider using a backend API or Cloudflare Workers
 * to handle uploads securely.
 */

// R2 Configuration from environment variables
const R2_CONFIG = {
  accountId: (process.env as any).CLOUDFLARE_R2_ACCOUNT_ID || '',
  accessKeyId: (process.env as any).CLOUDFLARE_R2_ACCESS_KEY_ID || '',
  secretAccessKey: (process.env as any).CLOUDFLARE_R2_SECRET_ACCESS_KEY || '',
  bucketName: (process.env as any).CLOUDFLARE_R2_BUCKET_NAME || 'ant-market-storage',
  publicUrl: (process.env as any).CLOUDFLARE_R2_PUBLIC_URL || '',
  endpoint: (process.env as any).CLOUDFLARE_R2_ENDPOINT || '',
  region: (process.env as any).CLOUDFLARE_R2_REGION || 'auto',
};

/**
 * Create SHA-256 hash (hex string) - async version
 */
async function createSha256Hash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * HMAC-SHA256 (returns ArrayBuffer)
 */
async function hmacSha256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyBuffer = typeof key === 'string' ? encoder.encode(key) : key;
  const dataBuffer = encoder.encode(data);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  return await crypto.subtle.sign('HMAC', cryptoKey, dataBuffer);
}

/**
 * Convert ArrayBuffer to hex string
 */
function arrayBufferToHex(buffer: ArrayBuffer): string {
  const array = new Uint8Array(buffer);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Uploads JSON content to R2 and returns the file key (path)
 */
export const uploadToR2 = async (content: object, filename: string): Promise<string> => {
  if (!R2_CONFIG.accessKeyId || !R2_CONFIG.secretAccessKey) {
    throw new Error('R2 credentials are not configured. Please check your environment variables.');
  }

  const fileKey = `exercises/${filename}`;
  const contentStr = JSON.stringify(content);
  const contentBytes = new TextEncoder().encode(contentStr);
  
  // Get content hash
  const contentHash = await createSha256Hash(contentStr);
  
  // Create date strings
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const datetime = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  
  // Parse endpoint URL
  const endpointUrl = new URL(R2_CONFIG.endpoint);
  const hostname = endpointUrl.hostname;
  
  // Create headers for signature
  const headers: Record<string, string> = {
    'host': hostname,
    'content-type': 'application/json',
    'x-amz-date': datetime,
    'x-amz-content-sha256': contentHash,
  };
  
  // Create signature
  const path = `/${R2_CONFIG.bucketName}/${fileKey}`;
  const authorization = await createSignatureAsync('PUT', path, headers, contentStr, datetime, date);
  
  // Upload to R2 - R2 S3 API uses: https://{account_id}.r2.cloudflarestorage.com/{bucket}/{key}
  const url = `${R2_CONFIG.endpoint}/${R2_CONFIG.bucketName}/${fileKey}`;
  
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-amz-date': datetime,
        'x-amz-content-sha256': contentHash,
        'Authorization': authorization,
      },
      body: contentBytes,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`R2 upload failed: ${response.status} ${response.statusText}. ${errorText}`);
    }
    
    return fileKey; // Return the file key/path for loading later
  } catch (error: any) {
    throw new Error(`Failed to upload to R2: ${error.message}`);
  }
};

/**
 * Async wrapper for createSignature (handles async hash functions)
 */
async function createSignatureAsync(
  method: string,
  path: string,
  headers: Record<string, string>,
  payload: string,
  datetime: string,
  date: string
): Promise<string> {
  const hash = await createSha256Hash(payload);
  
  // Create canonical request
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]}\n`)
    .join('');
  
  const signedHeaders = Object.keys(headers)
    .sort()
    .join(';');
  
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    '',
    signedHeaders,
    hash,
  ].join('\n');
  
  // Create string to sign
  const credentialScope = `${date}/${R2_CONFIG.region}/s3/aws4_request`;
  
  const canonicalRequestHash = await createSha256Hash(canonicalRequest);
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetime,
    credentialScope,
    canonicalRequestHash,
  ].join('\n');
  
  // Calculate signature using HMAC
  const kDateBuffer = await hmacSha256(`AWS4${R2_CONFIG.secretAccessKey}`, date);
  const kRegionBuffer = await hmacSha256(kDateBuffer, R2_CONFIG.region);
  const kServiceBuffer = await hmacSha256(kRegionBuffer, 's3');
  const kSigningBuffer = await hmacSha256(kServiceBuffer, 'aws4_request');
  const signatureBuffer = await hmacSha256(kSigningBuffer, stringToSign);
  const signature = arrayBufferToHex(signatureBuffer);
  
  // Create authorization header
  const authorization = [
    'AWS4-HMAC-SHA256',
    `Credential=${R2_CONFIG.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(', ');
  
  return authorization;
}

/**
 * Loads JSON content from R2 using the file key
 * Uses public URL if available, otherwise uses signed request
 */
export const loadFromR2 = async (fileKey: string, retries: number = 3): Promise<any> => {
  let url: string;
  
  // Use public URL if available, otherwise use endpoint
  if (R2_CONFIG.publicUrl) {
    url = `${R2_CONFIG.publicUrl}/${fileKey}`;
  } else {
    // For private files, we would need to generate a presigned URL
    // For now, assume public URL is set
    url = `${R2_CONFIG.endpoint.replace(/\/$/, '')}/${fileKey}`;
  }
  
  try {
    const response = await fetch(url, {
      method: 'GET',
    });
    
    if (!response.ok) {
      if (retries > 0 && (response.status === 502 || response.status === 503)) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return loadFromR2(fileKey, retries - 1);
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
      return loadFromR2(fileKey, retries - 1);
    }
    
    throw new Error(`Không thể tải file từ R2: ${error.message || 'Lỗi không xác định'}`);
  }
};

