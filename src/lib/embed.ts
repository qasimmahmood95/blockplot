/**
 * Serialize a dataset for an inline `<script type="application/json">` tag.
 *
 * Islands read their data from the DOM rather than importing JSON directly,
 * so one island file can serve any currency: the page embeds the currency it
 * renders, and the client bundle carries no dataset at all. Every `<` becomes
 * `\\u003c`, which JSON.parse reads back identically but the HTML parser can no
 * longer see as the `</script>` that would end the element early.
 */
export function toJsonScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
