/** Lien « click to chat » WhatsApp (https://wa.me/<numéro international sans +>?text=...). */
export function whatsappLink(phoneE164: string | null | undefined, text: string): string | null {
  const digits = (phoneE164 ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
