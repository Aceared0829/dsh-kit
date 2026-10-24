/**
 * Browser half of the image viewer: replaces the four shipped image galleries
 * with a thumb-grid that opens an enhanced viewer (zoom, pan, download,
 * keyboard paging) instead of the bare original-size lightbox.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-image-viewer',
  factory(require) {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const h = React.createElement;

    const NS = 'image-viewer';
    const SLOTS = [
      'conversation.chat.message.images',
      'conversation.chat.user.images',
      'conversation.trajectory.images',
      'tool.call.images',
    ];

    const EN = {
      image: 'Image',
      open: 'Open image',
      openNamed: 'Open {name}',
      loading: 'Loading image…',
      loadFailed: 'Image failed to load',
      retry: 'Retry',
      close: 'Close viewer',
      prev: 'Previous image',
      next: 'Next image',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      fit: 'Fit to window',
      download: 'Download',
      openTab: 'Open in new tab',
      counter: '{index} / {total}',
      gallery: '{count} images',
    };

    const ZH = {
      image: '图片',
      open: '查看图片',
      openNamed: '查看 {name}',
      loading: '图片加载中…',
      loadFailed: '图片加载失败',
      retry: '重试',
      close: '关闭看图',
      prev: '上一张',
      next: '下一张',
      zoomIn: '放大',
      zoomOut: '缩小',
      fit: '适应窗口',
      download: '下载',
      openTab: '新标签页打开',
      counter: '{index} / {total}',
      gallery: '{count} 张图片',
    };

    /** Tiny stroke icons drawn inline so the bundle needs no vendored icon set. */
    function Icon({ children, size = 16 }) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block' },
      }, children);
    }
    const IconClose = () => h(Icon, null, h('path', { d: 'M6 6l12 12M18 6L6 18' }));
    const IconPlus = () => h(Icon, null, h('path', { d: 'M12 5v14M5 12h14' }));
    const IconMinus = () => h(Icon, null, h('path', { d: 'M5 12h14' }));
    const IconFit = () => h(Icon, null, h('path', { d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' }));
    const IconDownload = () => h(Icon, null,
      h('path', { d: 'M12 4v11M8 11l4 4 4-4M5 19h14' }));
    const IconExternal = () => h(Icon, null,
      h('path', { d: 'M14 5h5v5M19 5l-8 8M9 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3' }));
    const IconPrev = () => h(Icon, null, h('path', { d: 'M15 5l-7 7 7 7' }));
    const IconNext = () => h(Icon, null, h('path', { d: 'M9 5l7 7-7 7' }));
    const IconRetry = () => h(Icon, null,
      h('path', { d: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5' }));

    /** Stable cache key for one gallery entry. */
    function imageId(image) {
      return 'attachment' in image ? `a:${image.attachment.attachmentId}` : `p:${image.preview.url}`;
    }

    /** Intrinsic dimensions when the entry carries them. */
    function dimensionsOf(image) {
      if ('attachment' in image) {
        const { width, height } = image.attachment;
        return width && height ? { width, height } : undefined;
      }
      const { width, height } = image.preview;
      return width && height ? { width, height } : undefined;
    }

    /**
     * Lone-image display box: long edge 240px, aspect clamped to [0.25, 4],
     * never upscaled past the natural size.
     */
    function singleFit(dimensions) {
      const natural = dimensions.width / dimensions.height;
      const ratio = Math.min(4, Math.max(0.25, natural));
      const box = ratio >= 1
        ? { width: 240, height: 240 / ratio }
        : { width: 240 * ratio, height: 240 };
      const scale = Math.min(1, dimensions.width / box.width, dimensions.height / box.height);
      return {
        width: Math.max(1, Math.round(box.width * scale)),
        height: Math.max(1, Math.round(box.height * scale)),
        objectPosition: natural < 0.25 ? 'center top' : natural > 4 ? 'left center' : 'center',
      };
    }

    /** Display name of one entry, used in tooltips and as the download filename. */
    function nameOf(image, t) {
      if ('attachment' in image) return image.label ?? image.attachment.name ?? t('image');
      return image.preview.name ?? t('image');
    }

    /**
     * Deliver one image URL, caching resolved durable URLs for the session so
     * reopening the viewer does not re-round-trip the loader.
     */
    const urlCache = new Map();

    function useImageUrl(image, load) {
      const previewUrl = 'preview' in image ? image.preview.url : undefined;
      const key = imageId(image);
      const [attempt, setAttempt] = React.useState(0);
      const [state, setState] = React.useState(() => ({
        url: previewUrl ?? urlCache.get(key) ?? ('attachment' in image && load.peek ? load.peek(image.attachment) : undefined) ?? null,
        error: false,
      }));

      React.useEffect(() => {
        if (previewUrl !== undefined) {
          setState({ url: previewUrl, error: false });
          return undefined;
        }
        let live = true;
        const cached = urlCache.get(key) ?? (load.peek ? load.peek(image.attachment) : undefined);
        setState({ url: cached ?? null, error: false });
        load(image.attachment).then(
          (url) => {
            urlCache.set(key, url);
            if (live) setState({ url, error: false });
          },
          () => { if (live) setState({ url: null, error: true }); },
        );
        return () => { live = false; };
      }, [key, attempt, load, previewUrl]);

      const retry = React.useCallback(() => { setAttempt((n) => n + 1); }, []);
      return { url: state.url, error: state.error, retry };
    }

    /** Shared control surface for the viewer chrome. */
    function ToolButton({ label, onClick, disabled, children, active }) {
      return h('button', {
        type: 'button',
        title: label,
        'aria-label': label,
        disabled: disabled || undefined,
        onClick,
        style: {
          display: 'grid',
          placeItems: 'center',
          width: 34,
          height: 34,
          padding: 0,
          border: '1px solid transparent',
          borderRadius: 10,
          background: active ? 'rgba(255,255,255,0.16)' : 'transparent',
          color: disabled ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.92)',
          cursor: disabled ? 'default' : 'pointer',
          flex: '0 0 auto',
        },
      }, children);
    }

    /**
     * Full-viewport viewer: wheel/button zoom, drag pan, download, open-in-tab
     * and arrow-key paging across the owning gallery.
     */
    function Viewer({ images, index, setIndex, onClose, load, t }) {
      const image = images[index];
      const { url, error, retry } = useImageUrl(image, load);
      const [scale, setScale] = React.useState(1);
      const [offset, setOffset] = React.useState({ x: 0, y: 0 });
      const [natural, setNatural] = React.useState(null);
      const [dragging, setDragging] = React.useState(false);
      const dragRef = React.useRef(null);
      const closeRef = React.useRef(null);
      const restoreRef = React.useRef(null);

      const multiple = images.length > 1;
      const label = nameOf(image, t);

      const reset = React.useCallback(() => {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }, []);

      // A fresh entry starts fitted again.
      React.useEffect(() => {
        setScale(1);
        setOffset({ x: 0, y: 0 });
        setNatural(null);
      }, [index]);

      const zoomBy = React.useCallback((factor) => {
        setScale((current) => {
          const next = Math.min(8, Math.max(0.25, current * factor));
          if (next <= 1) setOffset({ x: 0, y: 0 });
          return next;
        });
      }, []);

      const step = React.useCallback((delta) => {
        setIndex((current) => (current + delta + images.length) % images.length);
      }, [images.length, setIndex]);

      React.useEffect(() => {
        restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (closeRef.current) closeRef.current.focus();
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key === 'ArrowRight' && multiple) { event.preventDefault(); step(1); return; }
          if (event.key === 'ArrowLeft' && multiple) { event.preventDefault(); step(-1); return; }
          if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomBy(1.25); return; }
          if (event.key === '-' || event.key === '_') { event.preventDefault(); zoomBy(0.8); return; }
          if (event.key === '0') { event.preventDefault(); reset(); }
        };
        window.addEventListener('keydown', onKeyDown, true);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
          window.removeEventListener('keydown', onKeyDown, true);
          document.body.style.overflow = previousOverflow;
          if (restoreRef.current && restoreRef.current.isConnected) restoreRef.current.focus();
        };
      }, [multiple, onClose, reset, step, zoomBy]);

      // React routes `onWheel` through a passive root listener, so preventDefault
      // there only logs a warning — the stage owns a native non-passive one.
      const stageRef = React.useRef(null);
      React.useEffect(() => {
        const node = stageRef.current;
        if (node === null) return undefined;
        const onWheel = (event) => {
          event.preventDefault();
          zoomBy(event.deltaY < 0 ? 1.12 : 0.89);
        };
        node.addEventListener('wheel', onWheel, { passive: false });
        return () => { node.removeEventListener('wheel', onWheel, { passive: false }); };
      }, [zoomBy]);

      const onPointerDown = (event) => {
        if (scale <= 1 || event.button !== 0) return;
        dragRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          originX: offset.x,
          originY: offset.y,
        };
        setDragging(true);
        if (event.currentTarget.setPointerCapture) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      };
      const onPointerMove = (event) => {
        const drag = dragRef.current;
        if (drag === null || drag.pointerId !== event.pointerId) return;
        setOffset({
          x: drag.originX + (event.clientX - drag.x),
          y: drag.originY + (event.clientY - drag.y),
        });
      };
      const endDrag = (event) => {
        if (dragRef.current === null) return;
        if (event.currentTarget.releasePointerCapture && dragRef.current.pointerId === event.pointerId) {
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
        }
        dragRef.current = null;
        setDragging(false);
      };

      const download = async () => {
        if (url === null) return;
        try {
          const response = await fetch(url);
          const blob = await response.blob();
          const objectUrl = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = objectUrl;
          anchor.download = label;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => { URL.revokeObjectURL(objectUrl); }, 5000);
        } catch {
          window.open(url, '_blank', 'noopener');
        }
      };

      const chromeButton = { display: 'flex', alignItems: 'center', gap: 6 };

      const stage = h('div', {
        ref: stageRef,
        onPointerDown,
        onPointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        style: {
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          overflow: 'hidden',
          cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default',
          touchAction: 'none',
        },
      },
      error
        ? h('button', {
          type: 'button',
          onClick: retry,
          style: {
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 14px',
            border: '1px solid rgba(255,255,255,0.24)',
            borderRadius: 12,
            background: 'rgba(255,255,255,0.08)',
            color: 'rgba(255,255,255,0.9)',
            cursor: 'pointer',
            fontSize: 13,
          },
        }, h(IconRetry), t('loadFailed'), '·', t('retry'))
        : url === null
          ? h('span', { style: { color: 'rgba(255,255,255,0.7)', fontSize: 13 } }, t('loading'))
          : h('img', {
            src: url,
            alt: label,
            draggable: false,
            onLoad: (event) => {
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              });
            },
            onDoubleClick: () => { if (scale === 1) setScale(2); else reset(); },
            style: {
              display: 'block',
              maxWidth: scale <= 1 ? '94vw' : 'none',
              maxHeight: scale <= 1 ? '86vh' : 'none',
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              transformOrigin: 'center center',
              transition: dragging ? 'none' : 'transform 120ms ease-out',
              userSelect: 'none',
              WebkitUserDrag: 'none',
              boxShadow: '0 18px 60px rgba(0,0,0,0.55)',
              borderRadius: 6,
            },
          }));

      const topBar = h('div', {
        style: {
          position: 'absolute',
          top: 0, left: 0, right: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 14px',
          background: 'linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0))',
          color: 'rgba(255,255,255,0.92)',
          fontSize: 13,
          pointerEvents: 'none',
        },
      },
      h('span', {
        title: label,
        style: {
          maxWidth: '46vw', overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', fontWeight: 550,
        },
      }, label),
      h('span', { style: { opacity: 0.62, fontSize: 12 } },
        multiple ? t('counter', { index: index + 1, total: images.length }) : null,
        natural === null ? null : `  ·  ${natural.width}×${natural.height}`),
      h('span', { style: { flex: 1 } }),
      h('span', { style: { ...chromeButton, pointerEvents: 'auto' } },
        h(ToolButton, { label: t('close'), onClick: onClose },
          h('span', { ref: closeRef, tabIndex: -1 }, h(IconClose)))));

      const bottomBar = h('div', {
        style: {
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.14)',
          background: 'rgba(20,20,22,0.72)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
        },
      },
      multiple && h(ToolButton, { label: t('prev'), onClick: () => { step(-1); } }, h(IconPrev)),
      h(ToolButton, { label: t('zoomOut'), onClick: () => { zoomBy(0.8); } }, h(IconMinus)),
      h('button', {
        type: 'button',
        title: t('fit'),
        'aria-label': t('fit'),
        onClick: reset,
        style: {
          minWidth: 52,
          height: 34,
          padding: '0 6px',
          border: 0,
          borderRadius: 10,
          background: 'transparent',
          color: 'rgba(255,255,255,0.86)',
          font: 'inherit',
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
          cursor: 'pointer',
        },
      }, `${Math.round(scale * 100)}%`),
      h(ToolButton, { label: t('zoomIn'), onClick: () => { zoomBy(1.25); } }, h(IconPlus)),
      h(ToolButton, { label: t('fit'), onClick: reset }, h(IconFit)),
      url === null ? null : h(ToolButton, { label: t('download'), onClick: download }, h(IconDownload)),
      url === null ? null : h(ToolButton, {
        label: t('openTab'),
        onClick: () => { window.open(url, '_blank', 'noopener'); },
      }, h(IconExternal)),
      multiple && h(ToolButton, { label: t('next'), onClick: () => { step(1); } }, h(IconNext)));

      return createPortal(h('div', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': label,
        onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); },
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: 2147483000,
          background: 'rgba(8,8,10,0.92)',
          animation: 'dsh-image-viewer-fade 120ms ease-out',
        },
      }, stage, topBar, bottomBar), document.body);
    }

    /** One thumbnail: click opens the viewer at this index. */
    function Thumb({ image, variant, load, labels, onOpen }) {
      const { url, error, retry } = useImageUrl(image, load);
      const dimensions = React.useMemo(() => dimensionsOf(image), [image]);
      const fit = React.useMemo(() => {
        if (variant !== 'single') return undefined;
        return dimensions === undefined
          ? { width: 240, height: 240, objectPosition: 'center' }
          : singleFit(dimensions);
      }, [dimensions, variant]);

      const base = {
        display: 'grid',
        placeItems: 'center',
        padding: 0,
        overflow: 'hidden',
        border: '0.5px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.08))',
        cursor: 'zoom-in',
        color: 'var(--dsw-alias-label-secondary)',
      };
      const sized = variant === 'tile'
        ? { ...base, flex: '0 0 auto', width: 64, height: 64, minWidth: 64, minHeight: 64, borderRadius: 12 }
        : variant === 'thumbnail'
          ? { ...base, flex: '0 0 auto', boxSizing: 'border-box', width: 48, height: 48, minWidth: 48, minHeight: 48, padding: 2, borderRadius: 10 }
          : {
            ...base,
            flex: '0 0 auto',
            minWidth: 44,
            minHeight: 44,
            borderRadius: 14,
            ...(fit === undefined ? {} : { width: fit.width, height: fit.height }),
          };

      if (error) {
        return h('button', {
          type: 'button',
          className: 'dsh-image-viewer-thumb',
          title: labels.loadFailed,
          'aria-label': labels.loadFailed,
          onClick: retry,
          style: { ...sized, cursor: 'pointer', color: 'var(--dsw-alias-state-error-primary)' },
        }, h(IconRetry));
      }

      const name = nameOf(image, labels.t);
      return h('button', {
        type: 'button',
        className: 'dsh-image-viewer-thumb',
        title: url === null ? labels.loading : labels.openNamed({ name }),
        'aria-label': url === null ? labels.loading : labels.openNamed({ name }),
        'aria-busy': url === null || undefined,
        onClick: () => { if (url !== null) onOpen(); },
        style: sized,
      }, url === null
        ? h('span', { style: { fontSize: 12, padding: 4 } }, labels.loading)
        : h('img', {
          src: url,
          alt: name,
          draggable: false,
          style: {
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: variant === 'thumbnail' ? 'contain' : 'cover',
            ...(variant === 'single' && fit !== undefined ? { objectPosition: fit.objectPosition } : {}),
          },
        }));
    }

    /** Gallery replacement for the four shipped image slots. */
    function makeGallery(t, locale) {
      return function ImageViewerGallery(props) {
        const images = Array.isArray(props.images) ? props.images : [];
        const load = props.loadImage ?? props.load;
        const align = props.align === 'end' ? 'end' : 'start';
        const compact = props.compact === true;
        const thumbnail = props.thumbnail === true;
        const [openIndex, setOpenIndex] = React.useState(null);

        // Re-render on a locale switch so the copy follows the active language.
        const revision = React.useSyncExternalStore
          ? React.useSyncExternalStore(
            (onChange) => (locale && typeof locale.subscribe === 'function' ? locale.subscribe(onChange) : () => {}),
            () => (locale && typeof locale.getSnapshot === 'function' ? locale.getSnapshot().revision : 0),
            () => 0,
          )
          : 0;

        const labels = React.useMemo(() => ({
          t,
          loading: t('loading'),
          loadFailed: t('loadFailed'),
          openNamed: ({ name }) => t('openNamed', { name }),
        }), [revision, t]);

        if (images.length === 0 || load === undefined) return null;
        const variant = thumbnail ? 'thumbnail' : compact || images.length > 1 ? 'tile' : 'single';

        return h(React.Fragment, null,
          h('div', {
            role: 'group',
            'aria-label': t('gallery', { count: images.length }),
            style: {
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
              maxWidth: '100%',
              justifyContent: align === 'end' ? 'flex-end' : 'flex-start',
              alignSelf: align === 'end' ? 'flex-end' : 'flex-start',
            },
          }, images.map((image, index) => h(Thumb, {
            key: `${imageId(image)}:${index}`,
            image,
            variant,
            load,
            labels,
            onOpen: () => { setOpenIndex(index); },
          }))),
          openIndex === null ? null : h(Viewer, {
            images,
            index: Math.min(openIndex, images.length - 1),
            setIndex: setOpenIndex,
            onClose: () => { setOpenIndex(null); },
            load,
            t,
          }));
      };
    }

    const FALLBACK = {
      image: 'Image',
      open: 'Open image',
      openNamed: 'Open {name}',
      loading: 'Loading image…',
      loadFailed: 'Image failed to load',
      retry: 'Retry',
      close: 'Close viewer',
      prev: 'Previous image',
      next: 'Next image',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      fit: 'Fit to window',
      download: 'Download',
      openTab: 'Open in new tab',
      counter: '{index} / {total}',
      gallery: '{count} images',
    };

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.locale;
        if (locale && typeof locale.register === 'function') {
          ctx.effect(() => {
            const offEn = locale.register(NS, 'en', EN);
            const offZh = locale.register(NS, 'zh', ZH);
            return () => { offEn(); offZh(); };
          });
        }
        const t = locale && typeof locale.bind === 'function'
          ? locale.bind(NS)
          : (key, params) => {
            const template = FALLBACK[key] ?? key;
            if (!params) return template;
            return template.replace(/\{(\w+)\}/g, (match, name) => (
              name in params ? String(params[name]) : match
            ));
          };
        const Gallery = makeGallery(t, locale);

        ctx.effect(() => {
          const style = document.createElement('style');
          style.dataset.dshImageViewer = '';
          style.textContent = [
            '@keyframes dsh-image-viewer-fade{from{opacity:0}to{opacity:1}}',
            '.dsh-image-viewer-thumb:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
            '.dsh-image-viewer-thumb:hover{filter:brightness(1.06)}',
            '@media (prefers-reduced-motion: reduce){.dsh-image-viewer-thumb{transition:none}}',
          ].join('');
          document.head.appendChild(style);
          return () => { style.remove(); };
        });

        for (const name of SLOTS) {
          ctx.effect(() => ctx.slots.inject(name, () => ctx.slots.register({
            name,
            priority: 50,
          }, Gallery)));
        }
      },
    };
  },
});
