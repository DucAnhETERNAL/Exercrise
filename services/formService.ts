import { StudentSubmission, GoogleFormConfig } from "../types";

/**
 * Submits the student data to a Google Form.
 * Note: Google Forms does not support CORS for POST requests from client-side JS.
 * We use mode: 'no-cors' which sends the data but returns an opaque response (we won't know 100% if it succeeded).
 * However, this is the standard way to do serverless form submissions.
 */
export const submitToGoogleForm = async (
  submission: StudentSubmission,
  config: GoogleFormConfig
): Promise<void> => {
  if (!config.formUrl || !config.nameEntryId || !config.scoreEntryId) {
    throw new Error("Cấu hình Google Form chưa đầy đủ. Vui lòng liên hệ giáo viên.");
  }

  // Ensure URL ends with formResponse
  let submitUrl = config.formUrl;
  if (submitUrl.endsWith('/viewform')) {
      submitUrl = submitUrl.replace('/viewform', '/formResponse');
  } else if (!submitUrl.endsWith('/formResponse')) {
     // If it's a short link or edit link, this might fail, but let's try to append if it looks like a base ID
     if (!submitUrl.includes('/')) {
         // Assuming ID only
         submitUrl = `https://docs.google.com/forms/d/e/${submitUrl}/formResponse`;
     }
  }

  // Construct Form Data
  const formData = new FormData();
  formData.append(config.nameEntryId, submission.studentName);
  formData.append(config.scoreEntryId, `${submission.score.correct}/${submission.score.total}`);
  if (config.feedbackEntryId) {
    formData.append(config.feedbackEntryId, submission.feedback || "");
  }

  try {
    await fetch(submitUrl, {
      method: "POST",
      mode: "no-cors", // Important: bypasses CORS error, but response is opaque
      body: formData,
    });
    // Since we use no-cors, we assume success if no network error occurred.
    return;
  } catch (error) {
    throw new Error("Không thể gửi kết quả. Vui lòng kiểm tra kết nối mạng.");
  }
};