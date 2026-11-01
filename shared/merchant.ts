// Who a bank line is with, without the bank's boilerplate. Shared by the review queue and the
// rule suggestion, so a rule made from a group catches the whole group. No Node or DOM imports.

// mBank: "MERCHANT ZAKUP PRZY UŻYCIU KARTY…", "NAME, TITLE PRZELEW WŁASNY 1234…", "… BLIK P2P…";
// Pekao: "MERCHANT CITY · *********0090658". Long digit runs are account and card numbers.
const BOILERPLATE = / (?:ZAKUP PRZY|ZWROT|BLIK|PRZELEW|WYPŁATA GOTÓWKI|PP\/)|\s·\s|\s\*+\d|\s\d{4,}/i;

/**
 * The merchant or counterparty part of a description, at most 40 characters and ending at a word. It is always a
 * leading piece of the description, so a rule with this text matches the line it came from.
 */
export function merchantKey(description: string): string {
  const d = description.replace(/\s+/g, ' ').trim();
  const cut = d.search(BOILERPLATE);
  const m = cut > 0 ? d.slice(0, cut) : d;
  // a long name ends at a word, not part-way through one
  const short = m.length > 40 ? m.slice(0, 41).replace(/\s+\S*$/, '') || m.slice(0, 40) : m;
  return short.replace(/[\s,.;:-]+$/, '');
}
