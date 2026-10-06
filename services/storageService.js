/**
 * Placeholder Storage Service
 * Firebase Storage is currently disabled (project is on the Spark plan).
 * These methods will be implemented later.
 */

/**
 * Upload an image to Firebase Storage
 * @param {File} file - The image file to upload
 * @param {string} path - The destination path in storage
 * @returns {Promise<string>} The download URL of the uploaded image
 */
export const uploadImage = async (file, path) => {
  // TODO: Implement Storage image upload logic when Storage is enabled
  console.warn("Storage is not enabled yet. uploadImage is a placeholder.");
  return "https://via.placeholder.com/150";
};

/**
 * Upload a document to Firebase Storage
 * @param {File} file - The document file to upload
 * @param {string} path - The destination path in storage
 * @returns {Promise<string>} The download URL of the uploaded document
 */
export const uploadDocument = async (file, path) => {
  // TODO: Implement Storage document upload logic when Storage is enabled
  console.warn("Storage is not enabled yet. uploadDocument is a placeholder.");
  return "https://via.placeholder.com/150";
};

/**
 * Delete a file from Firebase Storage
 * @param {string} fileUrl - The URL of the file to delete
 * @returns {Promise<void>}
 */
export const deleteFile = async (fileUrl) => {
  // TODO: Implement Storage file deletion logic when Storage is enabled
  console.warn("Storage is not enabled yet. deleteFile is a placeholder.");
};
