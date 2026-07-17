import React, { useRef, useState, useEffect, useCallback } from 'react';
import './AnimatedList.css';

// Wraps a single list item: observes when it scrolls into view (via
// IntersectionObserver, replacing React Bits' `motion` + useInView) and
// toggles a CSS class that drives the fade/scale-in transition in
// AnimatedList.css. No animation library involved.
function AnimatedListItem({ children, index, onMouseEnter, onClick, itemClassName, registerRef, role, isSelected }) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={node => { ref.current = node; registerRef?.(node); }}
      data-index={index}
      role={role}
      aria-selected={role ? isSelected : undefined}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={`animated-list__item${inView ? ' animated-list__item--in-view' : ''}${itemClassName ? ` ${itemClassName}` : ''}`}
    >
      {children}
    </div>
  );
}

/**
 * Vanilla (no `motion`) port of React Bits' AnimatedList.
 *
 * Differs from the original in one way on purpose: instead of taking plain
 * `string[]` items, it takes any array plus a `renderItem` render-prop, so
 * each row can be arbitrary JSX (status badge, phone link, etc.) — the
 * animation/gradient/keyboard-nav shell stays generic and reusable.
 *
 * Props:
 *   items                  – array of any data
 *   renderItem(item, index, { isSelected }) – returns the row's JSX
 *   getKey(item, index)     – React key extractor (default: index)
 *   onItemSelect(item, i)   – click, Enter-while-focused, or keyboard select
 *   onItemRef(item, i, node) – optional, exposes each row's DOM node
 *   showGradients           – top/bottom fade overlays, only meaningful
 *                             alongside `maxHeight` (default true)
 *   enableArrowNavigation   – Up/Down/Tab moves selection, Enter opens (default true)
 *   displayScrollbar        – show the native scrollbar when `maxHeight` is set (default true)
 *   maxHeight               – CSS max-height of the scroll area. Omit (default)
 *                             to leave the list unconstrained so the page's
 *                             own scrollbar does the work — set this only if
 *                             you specifically want a bounded, independently
 *                             scrolling panel.
 */
export default function AnimatedList({
  items = [],
  renderItem,
  getKey,
  onItemSelect,
  onItemRef,
  showGradients = true,
  enableArrowNavigation = true,
  className = '',
  itemClassName = '',
  displayScrollbar = true,
  initialSelectedIndex = -1,
  maxHeight = null,
  ariaLabel,
}) {
  const listRef = useRef(null);
  const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex);
  const [keyboardNav, setKeyboardNav] = useState(false);
  const [topGradientOpacity, setTopGradientOpacity] = useState(0);
  const [bottomGradientOpacity, setBottomGradientOpacity] = useState(0);

  const handleItemMouseEnter = useCallback(index => setSelectedIndex(index), []);

  const handleItemClick = useCallback(
    (item, index) => {
      setSelectedIndex(index);
      listRef.current?.focus(); // so arrow keys work right after a click
      onItemSelect?.(item, index);
    },
    [onItemSelect]
  );

  const handleScroll = useCallback(e => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    setTopGradientOpacity(Math.min(scrollTop / 50, 1));
    const bottomDistance = scrollHeight - (scrollTop + clientHeight);
    setBottomGradientOpacity(scrollHeight <= clientHeight ? 0 : Math.min(bottomDistance / 50, 1));
  }, []);

  // Recompute gradient visibility whenever the list's own overflow could
  // have changed (item count changed, or no maxHeight was set at all —
  // in which case the list never overflows and both gradients should stay
  // hidden instead of the bottom one defaulting to visible).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setTopGradientOpacity(Math.min(scrollTop / 50, 1));
    setBottomGradientOpacity(scrollHeight <= clientHeight ? 0 : Math.min((scrollHeight - (scrollTop + clientHeight)) / 50, 1));
  }, [items.length, maxHeight]);

  // Arrow/Tab/Enter navigation — scoped to only fire while the list itself
  // is focused, so it never hijacks keys typed into filters/inputs elsewhere
  // on the page.
  useEffect(() => {
    if (!enableArrowNavigation) return undefined;
    const handleKeyDown = e => {
      if (document.activeElement !== listRef.current) return;
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        setKeyboardNav(true);
        setSelectedIndex(prev => Math.min(prev + 1, items.length - 1));
      } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        setKeyboardNav(true);
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        if (selectedIndex >= 0 && selectedIndex < items.length) {
          e.preventDefault();
          onItemSelect?.(items[selectedIndex], selectedIndex);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [items, selectedIndex, onItemSelect, enableArrowNavigation]);

  // Auto-scroll the keyboard-selected row into view — scrollIntoView finds
  // whichever ancestor actually scrolls (the list itself when `maxHeight`
  // is set, otherwise the page), so this works correctly either way.
  useEffect(() => {
    if (!keyboardNav || selectedIndex < 0 || !listRef.current) return;
    const selectedItem = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    selectedItem?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setKeyboardNav(false);
  }, [selectedIndex, keyboardNav]);

  return (
    <div className={`animated-list${className ? ` ${className}` : ''}`}>
      <div
        ref={listRef}
        tabIndex={0}
        role={ariaLabel ? 'listbox' : undefined}
        aria-label={ariaLabel}
        className={`animated-list__scroll${!displayScrollbar ? ' animated-list__scroll--no-scrollbar' : ''}`}
        style={{ '--animated-list-max-height': maxHeight ? (typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight) : 'none' }}
        onScroll={handleScroll}
      >
        {items.map((item, index) => (
          <AnimatedListItem
            key={getKey ? getKey(item, index) : index}
            index={index}
            role={ariaLabel ? 'option' : undefined}
            isSelected={selectedIndex === index}
            itemClassName={itemClassName}
            onMouseEnter={() => handleItemMouseEnter(index)}
            onClick={() => handleItemClick(item, index)}
            registerRef={node => onItemRef?.(item, index, node)}
          >
            {renderItem(item, index, { isSelected: selectedIndex === index })}
          </AnimatedListItem>
        ))}
      </div>

      {showGradients && (
        <>
          <div className="animated-list__top-gradient" style={{ opacity: topGradientOpacity }} />
          <div className="animated-list__bottom-gradient" style={{ opacity: bottomGradientOpacity }} />
        </>
      )}
    </div>
  );
}