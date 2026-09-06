/** Pure browser-screenshot derivation from persisted tool-result metadata. @module */
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { MessageImageSource } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolCallBlock } from './tool-call-model.ts'

/**
 * Derive the persisted screenshot of a settled `browser` verification result.
 * The browser tool persists `{ screenshotAttachment }` as presentation metadata
 * whenever its screenshot action saved an attachment; every other result shape
 * falls back to the generic row without an image.
 * @param block - running or settled Tool block.
 * @returns the durable image source, or null when the result carries no valid screenshot.
 */
export function toolScreenshotSource(block: ToolCallBlock): MessageImageSource | null {
  if (!('kind' in block) || block.isError) return null
  const name = block.call?.name
  if (name !== 'browser') return null
  if (typeof block.meta !== 'object' || block.meta === null || Array.isArray(block.meta)) return null
  const meta = block.meta as Record<string, unknown>
  const attachment = meta.screenshotAttachment
  if (typeof attachment !== 'object' || attachment === null || Array.isArray(attachment)) return null
  const { attachmentId, mediaType, width, height, bytes } = attachment as Record<string, unknown>
  if (typeof attachmentId !== 'string' || attachmentId === '') return null
  if (typeof mediaType !== 'string' || mediaType === '') return null
  if (typeof width !== 'number' || !Number.isInteger(width) || width < 1) return null
  if (typeof height !== 'number' || !Number.isInteger(height) || height < 1) return null
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 0) return null
  return {
    attachment: {
      attachmentId: attachmentId as ImageAttachmentRef['attachmentId'],
      mediaType: mediaType as ImageAttachmentRef['mediaType'],
      width,
      height,
      bytes,
    },
  }
}
