// Define minimal types for window.gapi and google
declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

// CẤU HÌNH GOOGLE DRIVE
// Client ID bạn đã cung cấp
const CLIENT_ID = '996603187510-dat989np34dietf2enqu46q3sdsf03km.apps.googleusercontent.com'; 
// Sử dụng DRIVE_API_KEY riêng biệt với Gemini API key
const DRIVE_API_KEY = (process.env as any).DRIVE_API_KEY || ''; 
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];
const SCOPES = "https://www.googleapis.com/auth/drive.file";

let tokenClient: any;
let gapiInited = false;
let gisInited = false;

export const initDriveApi = async (retries: number = 3): Promise<void> => {
  return new Promise((resolve, reject) => {
    // Timeout after 30 seconds
    const timeoutId = setTimeout(() => {
      reject(new Error('Timeout: Google API scripts took too long to load. Please refresh the page and try again.'));
    }, 30000);

    const checkInit = () => {
      if (window.gapi && window.google) {
        clearTimeout(timeoutId);
        window.gapi.load('client', async () => {
          try {
            // Add timeout for API initialization
            const initPromise = window.gapi.client.init({
              apiKey: DRIVE_API_KEY,
              discoveryDocs: DISCOVERY_DOCS,
            });
            
            // Race between init and timeout
            await Promise.race([
              initPromise,
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('API initialization timeout')), 15000)
              )
            ]);
            
            gapiInited = true;
            
            tokenClient = window.google.accounts.oauth2.initTokenClient({
              client_id: CLIENT_ID,
              scope: SCOPES,
              callback: '', // defined later within auth flow
            });
            gisInited = true;
            resolve();
          } catch (error: any) {
            // Retry logic for 502/503 errors or network issues
            const isRetryableError = 
              error.status === 502 || 
              error.status === 503 || 
              error.status === 0 ||
              error.message?.includes('502') || 
              error.message?.includes('503') ||
              error.message?.includes('Bad Gateway') ||
              error.message?.includes('Service Unavailable') ||
              error.message?.includes('timeout') ||
              error.message?.includes('API discovery response missing');
            
            if (retries > 0 && isRetryableError) {
              await new Promise(resolve => setTimeout(resolve, 2000 * (4 - retries))); // Exponential backoff
              return initDriveApi(retries - 1).then(resolve).catch(reject);
            }
            
            // Check if API key is missing
            if (!DRIVE_API_KEY) {
              reject(new Error('DRIVE_API_KEY is not set. Please check your environment variables. Note: Google Drive API requires a separate API key from Gemini API. Add DRIVE_API_KEY to your .env file.'));
              return;
            }
            
            // Provide helpful error message
            let errorMessage = `Failed to initialize Google Drive API: ${error.message || 'Unknown error'}`;
            if (error.status === 502 || error.message?.includes('502')) {
              errorMessage += '\n\nThis is usually a temporary Google server issue. The app will automatically retry. If the problem persists:\n1. Check your internet connection\n2. Verify your DRIVE_API_KEY is valid and has Drive API enabled\n3. Ensure Google Drive API is enabled in Google Cloud Console\n4. Make sure DRIVE_API_KEY is set in your .env file';
            }
            
            reject(new Error(errorMessage));
          }
        });
      } else {
        setTimeout(checkInit, 100);
      }
    };
    checkInit();
  });
};

const handleAuthClick = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    // 1. Setup Timeout: Nếu popup bị chặn hoặc origin sai, callback sẽ không bao giờ chạy.
    // Chúng ta set timeout 60s để báo lỗi thay vì treo app mãi mãi.
    const timeoutId = setTimeout(() => {
      reject(new Error("TIMEOUT_AUTH: Quá thời gian chờ đăng nhập. Có thể do:\n1. Popup bị trình duyệt chặn.\n2. URL hiện tại chưa được thêm vào 'Authorized JavaScript origins' trong Google Cloud Console.\n3. Bạn đã tắt popup đăng nhập mà không chọn tài khoản."));
    }, 60000);

    tokenClient.callback = async (resp: any) => {
      clearTimeout(timeoutId); // Xóa timeout nếu nhận được phản hồi
      
      if (resp.error !== undefined) {
        reject(resp);
        return;
      }
      resolve();
    };

    if (window.gapi.client.getToken() === null) {
      // Yêu cầu người dùng chọn tài khoản Google và cấp quyền nếu chưa có session
      tokenClient.requestAccessToken({prompt: 'consent'});
    } else {
      // Bỏ qua bước chọn tài khoản nếu đã đăng nhập
      clearTimeout(timeoutId); // Đã có token thì không cần timeout
      resolve(); 
    }
  });
};

/**
 * Uploads the JSON content to Google Drive and makes it public.
 * Returns the File ID.
 * Uses native Fetch API + Blob for better performance with large files (images).
 */
export const uploadToDrive = async (content: object, filename: string): Promise<string> => {
  if (!gapiInited || !gisInited) await initDriveApi();
  
  try {
    await handleAuthClick(); 
  } catch (error: any) {
    // Ném lỗi rõ ràng để UI hiển thị
    throw new Error(error.message || "Đăng nhập Google thất bại.");
  }

  const accessToken = window.gapi.client.getToken().access_token;
  
  // 1. Prepare Metadata and Content
  const metadata = {
    name: filename,
    mimeType: 'application/json',
  };

  // Convert content to string first
  const contentStr = JSON.stringify(content);
  const metadataStr = JSON.stringify(metadata);

  // 2. Construct Multipart Body using Blob (More memory efficient than string concat)
  const boundary = '-------314159265358979323846';
  const delimiter = "\r\n--" + boundary + "\r\n";
  const close_delim = "\r\n--" + boundary + "--";

  const multipartBody = new Blob(
    [
      delimiter,
      'Content-Type: application/json\r\n\r\n',
      metadataStr,
      delimiter,
      'Content-Type: application/json\r\n\r\n',
      contentStr,
      close_delim
    ],
    { type: 'multipart/related' }
  );

  // 3. Upload using Fetch API
  // Using 'uploadType=multipart' endpoint
  try {
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
    });

    if (!response.ok) {
        const errorText = await response.text();
        
        if (response.status === 403) {
        throw new Error("Lỗi quyền truy cập (403). Vui lòng đảm bảo bạn đã bật 'Google Drive API' trong Google Cloud Console.");
        }
        
        throw new Error(`Upload thất bại: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    const fileId = result.id;

    // 4. Make Public (Anyone with link can read)
    await window.gapi.client.drive.permissions.create({
        fileId: fileId,
        resource: {
        role: 'reader',
        type: 'anyone',
        }
    });

    return fileId;
  } catch (err: any) {
      throw new Error("Lỗi mạng khi upload: " + err.message);
  }
};

/**
 * Loads JSON content from a public Drive file using the API Key.
 */
export const loadFromDrive = async (fileId: string, retries: number = 3): Promise<any> => {
  if (!gapiInited) {
    // Chỉ cần gapi client để đọc file public thông qua API Key
    try {
      await initDriveApi();
    } catch (error: any) {
      throw new Error(`Failed to initialize Google Drive API: ${error.message}`);
    }
  }

  try {
    const response = await window.gapi.client.drive.files.get({
      fileId: fileId,
      alt: 'media', // Quan trọng: tải nội dung file
    });
    return response.result;
  } catch (error: any) {
    // Retry logic for network errors
    if (retries > 0 && (error.status === 502 || error.status === 503 || error.status === 0)) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return loadFromDrive(fileId, retries - 1);
    }
    
    if (error.status === 404) {
      throw new Error("Không thể tải file. File có thể đã bị xóa hoặc không tồn tại.");
    }
    
    if (error.status === 403) {
      throw new Error("Không có quyền truy cập file. File có thể chưa được chia sẻ công khai.");
    }
    
    throw new Error(`Không thể tải file: ${error.message || 'Lỗi không xác định'}`);
  }
};