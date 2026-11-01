/**
 * Hands a file the app holds in memory to the browser to save under the given name
 */
export function saveBlobAsFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()

  // The click starts the save from the address, so it is released once that has begun
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
