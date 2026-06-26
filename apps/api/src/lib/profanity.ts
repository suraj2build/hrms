/**
 * profanity.ts — lightweight server-side profanity guard for community content.
 *
 * Deliberately small and conservative: a curated blocklist matched on word
 * boundaries (so "Scunthorpe"-type false positives are avoided). Used to reject
 * posts, comments and wishes that contain slurs/obscenities before they reach
 * the feed. Not a replacement for human moderation (report flow + HR controls) —
 * a first line of defence per the blueprint's "profanity guard on comments".
 */

// Base obscenities/slurs. Kept terse; HR moderation handles edge cases.
const BLOCKLIST = [
  'fuck', 'shit', 'bitch', 'bastard', 'asshole', 'dickhead', 'cunt',
  'motherfucker', 'bullshit', 'slut', 'whore', 'retard', 'nigger', 'faggot',
]

// Match a blocked word on word boundaries, case-insensitive. Catches light
// obfuscation by tolerating repeated letters (e.g. "shiiit").
const PATTERN = new RegExp(
  '\\b(' + BLOCKLIST.map((w) => w.split('').map((c) => `${c}+`).join('')).join('|') + ')\\b',
  'i',
)

/** True if the text contains a blocked term. */
export function containsProfanity(text: string | null | undefined): boolean {
  if (!text) return false
  return PATTERN.test(text)
}
