import React, { useState, useRef, useEffect, useCallback, useId } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import '../../../styles/heroSelect.css';

// Branch switcher styled to match HeroUI's Select "With Description" variant
// (heroui.com/docs/react/components/select#with-description) using plain
// CSS/JSX only — no @heroui/react dependency. Each option shows the branch
// name as its label and the branch address as its description, same pattern
// as heroModal.css / NurseRosterManager's hand-rolled HeroUI modal shell.
//
// Keyboard support: Enter/Space toggles the popover, Arrow Up/Down moves
// through options (and opens the popover if closed), Escape closes it,
// typeahead-free (branch lists are short). Closes on outside click and
// on Escape, matching HeroUI's default listbox behavior.
export default function BranchSelect({ branches, value, onChange, placeholder = 'Toutes les agences' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const listboxId = useId();

  const options = [{ id: '', name: placeholder, address: null }, ...branches];
  const selectedIndex = options.findIndex(o => (o.id || '') === (value || ''));
  const selected = options[selectedIndex] || options[0];

  const close = useCallback(() => setIsOpen(false), []);

  // Outside click
  useEffect(() => {
    if (!isOpen) return;
    const onDown = e => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isOpen, close]);

  // Escape to dismiss
  useEffect(() => {
    if (!isOpen) return;
    const onKey = e => { if (e.key === 'Escape') { close(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  useEffect(() => {
    if (isOpen) setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isOpen && activeIndex >= 0 && listRef.current) {
      const el = listRef.current.querySelector(`[data-index="${activeIndex}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [isOpen, activeIndex]);

  const commit = idx => {
    const opt = options[idx];
    onChange(opt.id || null);
    close();
  };

  const onTriggerKeyDown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) { setIsOpen(true); return; }
      setActiveIndex(i => {
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        return (i + dir + options.length) % options.length;
      });
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (isOpen) commit(activeIndex); else setIsOpen(true);
    } else if (e.key === 'Escape') {
      close();
    }
  };

  return (
    <div className="hero-select hero-select--secondary" ref={rootRef}>
      <button
        type="button"
        className="hero-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-labelledby={undefined}
        role="combobox"
        aria-controls={listboxId}
        data-open={isOpen}
        onClick={() => setIsOpen(o => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        <Building2 size={13} className="hero-select__icon" />
        <span className="hero-select__value">{selected.name}</span>
        <ChevronDown size={14} className="hero-select__indicator" data-open={isOpen} />
      </button>

      {isOpen && (
        <div className="hero-select__popover">
          <ul className="hero-select__listbox" role="listbox" id={listboxId} ref={listRef}>
            {options.map((opt, idx) => {
              const isSelected = idx === selectedIndex;
              const isActive = idx === activeIndex;
              return (
                <li
                  key={opt.id || 'all'}
                  data-index={idx}
                  role="option"
                  aria-selected={isSelected}
                  className="hero-select__item"
                  data-active={isActive}
                  data-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => commit(idx)}
                >
                  <div className="hero-select__item-text">
                    <span className="hero-select__item-label">{opt.name}</span>
                   
                  </div>
                  {isSelected && <Check size={14} className="hero-select__item-indicator" />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}