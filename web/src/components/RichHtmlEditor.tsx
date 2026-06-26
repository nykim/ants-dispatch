import JoditEditor from 'jodit-react';
import { useMemo } from 'react';
import type { ComponentProps } from 'react';
import type { IJodit } from 'jodit/esm/types/jodit';

export type RichHtmlEditorHandle = IJodit;

type JoditConfig = NonNullable<ComponentProps<typeof JoditEditor>['config']>;

interface RichHtmlEditorProps {
  value: string;
  onChange: (html: string) => void;
  minHeight?: number;
  className?: string;
  onReady?: (editor: RichHtmlEditorHandle) => void;
  onPickImage?: () => void;
}

export function normalizeEmptyRichHtml(html: string) {
  const compact = html
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, '')
    .toLowerCase();

  if (
    compact === '' ||
    compact === '<p></p>' ||
    compact === '<p><br></p>' ||
    compact === '<p><br/></p>' ||
    compact === '<div><br></div>' ||
    compact === '<div><br/></div>'
  ) {
    return '';
  }

  return html;
}

export function RichHtmlEditor({
  value,
  onChange,
  minHeight = 320,
  className = '',
  onReady,
  onPickImage,
}: RichHtmlEditorProps) {
  const config = useMemo<JoditConfig>(() => {
    const controls = onPickImage
      ? {
          image: {
            exec: () => onPickImage(),
          },
        }
      : undefined;

    return {
      toolbarSticky: false,
      statusbar: false,
      showCharsCounter: false,
      showWordsCounter: false,
      showXPathInStatusbar: false,
      // Faithful for clean/hand-coded HTML pastes (the reason we use Jodit)...
      defaultActionOnPaste: 'insert_as_html',
      // ...but route Word/Google Docs/Office content through Jodit's cleaner so
      // tables keep their structure and mso-* junk is dropped. Falls back to
      // defaultActionOnPaste for non-Office HTML. (Office detection itself was
      // fixed in 4.12.23, so this now actually triggers.)
      defaultActionOnPasteFromWord: 'insert_clear_html',
      askBeforePasteHTML: false,
      askBeforePasteFromWord: false,
      // Grow with content; the wrapper (.wysiwyg-editor, overflow:auto) provides
      // the single scrollbar. In compose the wrapper is height-bounded by its
      // split-pane and its toolbar is pinned with position:sticky (see
      // styles.css). '100%' instead made Jodit add its own inner scrollbar on
      // top of the wrapper's, and let the toolbar scroll out of view.
      height: 'auto',
      minHeight,
      uploader: {
        insertImageAsBase64URI: false,
      },
      ...(controls ? { controls } : {}),
    };
  }, [minHeight, onPickImage]);

  return (
    <div
      className={`wysiwyg-editor jodit-editor-wrap ${className}`.trim()}
      style={{ minHeight }}
    >
      <JoditEditor
        value={value}
        config={config}
        onChange={onChange}
        editorRef={onReady}
      />
    </div>
  );
}
