import { useLayoutEffect, useRef, useState, type RefObject, type UIEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Tag } from '@/api/tags'
import LoadFailure from '@/components/errors/LoadFailure'
import ScrollableListMoreButton from '@/components/list-controls/MoreButton'
import TagRow from '@/pages/settings/components/tag-settings-section/list/Row'
import { TAG_LIST_HEIGHT_TRANSITION } from '@/pages/settings/components/tag-settings-section/constants'

/**
 * Renders the tag settings table, animating its container height to match the content so rows
 * appearing, leaving, or the empty state swapping in does not jump the surrounding layout
 */
export default function TagSettingsList({
  activeSearch,
  confirmingDeleteTagId,
  deletingTagId,
  editingTagId,
  hasMoreTags,
  listError,
  listFailed,
  showFetchingMoreTags,
  showInitialTagLoading,
  showTagListEnd,
  showTagListMoreIndicator,
  shouldScrollTags,
  tagListRef,
  visibleTags,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteRequest,
  onEdit,
  onEditCancel,
  onListMoreClick,
  onListScroll,
}: {
  activeSearch: string
  confirmingDeleteTagId: string | null
  deletingTagId: string | null
  editingTagId: string | null
  hasMoreTags: boolean
  listError: unknown
  listFailed: boolean
  showFetchingMoreTags: boolean
  showInitialTagLoading: boolean
  showTagListEnd: boolean
  showTagListMoreIndicator: boolean
  shouldScrollTags: boolean
  tagListRef: RefObject<HTMLDivElement | null>
  visibleTags: Tag[]
  onDeleteCancel: () => void
  onDeleteConfirm: (tag: Tag) => void | Promise<void>
  onDeleteRequest: (tag: Tag) => void
  onEdit: (tag: Tag) => void
  onEditCancel: () => void
  onListMoreClick: () => void
  onListScroll: (event: UIEvent<HTMLDivElement>) => void
}) {
  const shouldReduceMotion = useReducedMotion()
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [contentHeight, setContentHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    const element = contentRef.current
    if (!element) return undefined

    let frameId: number | null = null
    const updateHeight = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        setContentHeight(element.getBoundingClientRect().height)
      })
    }

    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [])

  // With no rows in hand nothing about the list is known, so the failure takes the place of the
  // empty text. With rows cached from an earlier session it sits above them and they stay
  const rows = visibleTags.length === 0 && !showInitialTagLoading ? (
    listFailed ? null : (
      <p className="py-3 text-center text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
        {activeSearch.trim() ? 'No tags match your search.' : 'No tags yet.'}
      </p>
    )
  ) : (
    <div className="relative">
      <div
        ref={tagListRef}
        className={shouldScrollTags ? 'max-h-[35rem] min-w-0 overflow-x-auto overflow-y-auto pr-2' : 'min-w-0 overflow-x-auto'}
        onScroll={shouldScrollTags ? onListScroll : undefined}
      >
        <table className="w-full table-fixed text-left text-[0.9375rem]">
          <colgroup>
            <col />
            <col style={{ width: '7rem' }} />
          </colgroup>
          <thead>
            <tr style={{ color: 'var(--app-text-muted)', borderBottom: '1px solid var(--app-border)' }}>
              <th
                scope="col"
                className={`app-label py-3 pl-4 pr-4 ${shouldScrollTags ? 'sticky top-0 z-10' : ''}`}
                style={{ background: 'var(--app-surface-soft)' }}
              >
                Tag
              </th>
              <th
                scope="col"
                className={`app-label py-3 pr-4 text-right ${shouldScrollTags ? 'sticky top-0 z-10' : ''}`}
                style={{ background: 'var(--app-surface-soft)' }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {visibleTags.map((tag, index) => (
                <TagRow
                  key={tag.id}
                  confirmingDelete={confirmingDeleteTagId === tag.id}
                  deleting={deletingTagId === tag.id}
                  isEditing={editingTagId === tag.id}
                  isLast={!showTagListEnd && !hasMoreTags && index === visibleTags.length - 1}
                  shouldReduceMotion={shouldReduceMotion}
                  tag={tag}
                  onDeleteCancel={onDeleteCancel}
                  onDeleteConfirm={onDeleteConfirm}
                  onDeleteRequest={onDeleteRequest}
                  onEdit={onEdit}
                  onEditCancel={onEditCancel}
                />
              ))}
            </AnimatePresence>
            {showTagListEnd && !showFetchingMoreTags && !showInitialTagLoading && (
              <tr>
                <td colSpan={2}>
                  <p
                    className="py-4 text-center text-sm italic"
                    style={{ color: 'var(--app-text-subtle)' }}
                  >
                    You've reached the end.
                  </p>
                </td>
              </tr>
            )}
            {showFetchingMoreTags && visibleTags.length > 0 && (
              <tr>
                <td colSpan={2}>
                  <p
                    className="py-4 text-center text-sm italic"
                    style={{ color: 'var(--app-text-subtle)' }}
                  >
                    Fetching more
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <ScrollableListMoreButton
        show={showTagListMoreIndicator}
        onClick={onListMoreClick}
        ariaLabel={hasMoreTags ? 'Show more tags' : 'Scroll tags down'}
      />
    </div>
  )

  const content = (
    <>
      {listFailed && <LoadFailure error={listError} subject="Tags" />}
      {rows}
    </>
  )

  return (
    <motion.div
      animate={contentHeight === null || shouldReduceMotion ? undefined : { height: contentHeight }}
      initial={false}
      transition={TAG_LIST_HEIGHT_TRANSITION}
      style={shouldReduceMotion ? undefined : { overflow: 'hidden' }}
    >
      <div ref={contentRef}>
        {content}
      </div>
    </motion.div>
  )
}
