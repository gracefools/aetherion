// Player mail: letters with up to five items and gold, sent from any village to any character,
// online or not. The server stores every letter in PostgreSQL; taking what a letter carries is one
// transaction with the character's bag, so nothing can be taken twice or lost.
export const MAIL_MAX_ITEMS = 5;
export const MAIL_SUBJECT_MAX = 40;
export const MAIL_BODY_MAX = 300;
export const MAIL_GOLD_MAX = 10_000_000;
/** Letters shown in the mailbox (newest first). */
export const MAIL_PAGE = 50;
/** Postage: a fee per letter and per item it carries. */
export const mailPostage = (items: number) => 30 + 20 * items;
export interface MailEntry {
  id: number;
  from: string;
  subject: string;
  body: string;
  items: { base: string; rar: number; qty: number; ilvl: number }[];
  gold: number;
  at: number;
  read: boolean;
  claimed: boolean;
}
