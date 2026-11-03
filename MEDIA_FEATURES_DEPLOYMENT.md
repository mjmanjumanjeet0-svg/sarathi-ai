# Sarathi AI media and attachment scope

## Supported behavior

- Photos: JPG, PNG, and WEBP are read locally in the browser with Hindi/English OCR.
- Documents: PDF, DOCX, TXT, CSV, MD, and JSON text is extracted locally in the browser.
- Before any extracted text is sent to the AI chat service, Sarathi asks the user for explicit confirmation.
- The original photo or document file is not uploaded by the attachment-reading flow.
- A user can remove a selected attachment before sending.
- Maximum 5 files per message; maximum 20 MB per file. Extracted text is limited before sending.

## Deliberately unavailable

- Video upload, video trimming, frame extraction, and video understanding are not supported.
- AI image generation, image editing, and visual photo understanding are disabled.
- No Workers AI media model is required or called by the supported photo OCR flow.
- The unused media-studio module and its video/image-generation interface have been removed.

## Privacy notes

- Selecting a file does not itself send it to the AI service.
- OCR and document text extraction happen in the browser.
- The confirmation dialog appears before extracted text is included in a chat request.
- Do not send private or sensitive text unless you intend to share that extracted text with the AI service.
