export function validateMessage(input) {
  if (typeof input !== 'string') {
    return { valid: false, reason: 'Message must be a string.' };
  }

  const message = input.trim();
  if (!message) {
    return { valid: false, reason: 'Message cannot be empty.' };
  }

  if (message.length > 2000) {
    return { valid: false, reason: 'Message exceeds 2000 characters.' };
  }

  return { valid: true, message };
}
