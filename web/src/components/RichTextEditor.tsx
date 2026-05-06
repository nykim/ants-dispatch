import { Editor as TinyEditor } from '@tinymce/tinymce-react';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Editor as TinyMCEEditor } from 'tinymce';
import type { Asset } from '../api/endpoints';
import { AssetPickerModal } from './AssetPickerModal';

// Self-hosted TinyMCE 7 (GPL). Each side-effect import registers part of the
// editor with `window.tinymce`, so the React wrapper finds it without making
// any network call to the TinyMCE CDN.
//
// Direct `.min.js` file paths (rather than directory imports that resolve to
// CommonJS `index.js` shims) keep Vite's dev server from choking on the
// `require()` call those shims contain. `tinymce/tinymce` MUST come first —
// the plugin/theme files reference `tinymce.X.add(...)` at evaluation time.
import 'tinymce/tinymce';
import 'tinymce/models/dom/model.min.js';
import 'tinymce/themes/silver/theme.min.js';
import 'tinymce/icons/default/icons.min.js';

// Skin + content stylesheets. These `.js` files are CSS-in-JS shims that
// register the stylesheets in TinyMCE's internal Resource registry so the
// editor doesn't need to fetch them by URL at init time.
import 'tinymce/skins/ui/oxide/skin.js';
import 'tinymce/skins/ui/oxide/content.js';
import 'tinymce/skins/content/default/content.js';

import 'tinymce/plugins/advlist/plugin.min.js';
import 'tinymce/plugins/autolink/plugin.min.js';
import 'tinymce/plugins/charmap/plugin.min.js';
import 'tinymce/plugins/code/plugin.min.js';
import 'tinymce/plugins/codesample/plugin.min.js';
import 'tinymce/plugins/emoticons/plugin.min.js';
import 'tinymce/plugins/emoticons/js/emojis.min.js';
import 'tinymce/plugins/fullscreen/plugin.min.js';
import 'tinymce/plugins/image/plugin.min.js';
import 'tinymce/plugins/link/plugin.min.js';
import 'tinymce/plugins/lists/plugin.min.js';
import 'tinymce/plugins/preview/plugin.min.js';
import 'tinymce/plugins/searchreplace/plugin.min.js';
import 'tinymce/plugins/table/plugin.min.js';
import 'tinymce/plugins/visualblocks/plugin.min.js';
import 'tinymce/plugins/wordcount/plugin.min.js';

export type RichTextEditorHandle = {
  insertImage: (src: string, alt: string) => void;
  /** Open the asset-library modal programmatically (e.g., from a host-page
   *  "+ Image" button rendered outside the editor toolbar). */
  openAssetPicker: () => void;
  focus: () => void;
};

export type RichTextToolbar = 'full' | 'medium' | 'minimal';

type Props = {
  value: string;
  onChange: (html: string) => void;
  toolbar?: RichTextToolbar;
  /** Override the default behavior when a user picks an asset from the
   *  library. The default is to insert an `<img>` at the editor's caret;
   *  a route can supply this to splice raw markup elsewhere (e.g., into a
   *  textarea when the user is editing source HTML). */
  onAssetSelect?: (asset: Asset) => void;
  minHeight?: number;
  /** Visible height in px (TinyMCE manages its own scroll within this). */
  height?: number | string;
};

const TOOLBARS: Record<RichTextToolbar, string> = {
  full:
    'undo redo | blocks fontsizeinput | ' +
    'bold italic underline strikethrough | forecolor backcolor removeformat | ' +
    'bullist numlist outdent indent | blockquote codesample | ' +
    'alignleft aligncenter alignright alignjustify | ' +
    'link assetimage table hr | charmap emoticons | ' +
    'searchreplace visualblocks preview fullscreen',
  medium: 'undo redo | bold italic | h2 h3 | bullist numlist | link removeformat',
  minimal: 'bold italic | bullist | link',
};

const FULL_PLUGINS = [
  'advlist', 'autolink', 'charmap', 'code', 'codesample', 'emoticons',
  'fullscreen', 'image', 'link', 'lists', 'preview', 'searchreplace',
  'table', 'visualblocks', 'wordcount',
].join(' ');
const LEAN_PLUGINS = 'autolink link lists';

// Match the project's serif body styling so the editor surface looks the same
// as TipTap did. Embedded into TinyMCE's iframe via `content_style`.
const CONTENT_STYLE = `
body {
  font-family: 'Source Serif 4', Georgia, serif;
  font-size: 15px;
  line-height: 1.6;
  color: #1a1a1a;
  padding: 18px 24px;
  margin: 0;
}
body > * + * { margin-top: 0.75em; }
h1 { font-size: 26px; line-height: 1.2; font-weight: 600; }
h2 { font-size: 21px; line-height: 1.25; font-weight: 600; }
h3 { font-size: 17px; line-height: 1.3; font-weight: 600; }
p { margin: 0; }
ul, ol { padding-left: 1.4em; }
li { margin: 0.2em 0; }
blockquote {
  border-left: 3px solid #b08968;
  padding-left: 14px;
  color: #555;
  font-style: italic;
  margin: 0;
}
a { color: #6f4e37; text-decoration: underline; }
img { max-width: 100%; height: auto; }
pre {
  background: #f4f1ec;
  padding: 10px 14px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  overflow-x: auto;
}
hr { border: none; border-top: 1px solid #d8d2c8; margin: 1.2em 0; }
`;

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(
  function RichTextEditor(
    { value, onChange, toolbar = 'full', onAssetSelect, minHeight, height },
    ref,
  ) {
    const editorRef = useRef<TinyMCEEditor | null>(null);
    const [pickerOpen, setPickerOpen] = useState(false);

    function insertImageAtCaret(src: string, alt: string) {
      const ed = editorRef.current;
      if (!ed) return;
      ed.insertContent(
        `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" style="max-width:100%;height:auto" />`,
      );
    }

    useImperativeHandle(
      ref,
      () => ({
        insertImage: insertImageAtCaret,
        openAssetPicker: () => setPickerOpen(true),
        focus: () => editorRef.current?.focus(),
      }),
      [],
    );

    function handleAssetPick(asset: Asset) {
      setPickerOpen(false);
      if (onAssetSelect) {
        onAssetSelect(asset);
        return;
      }
      // Default: insert <img> at the editor's caret. Strip extension and
      // dashes from the filename for a sensible alt text.
      const alt = asset.filename.replace(/\.[a-z0-9]+$/i, '').replace(/-/g, ' ');
      insertImageAtCaret(asset.url, alt);
    }

    // Stable init object — TinyMCE re-creates the editor whenever this
    // identity changes, which would blow away cursor state on every render.
    const init = useMemo(
      () => ({
        height: height ?? '100%',
        min_height: minHeight,
        menubar: false,
        statusbar: false,
        branding: false,
        promotion: false,
        plugins: toolbar === 'full' ? FULL_PLUGINS : LEAN_PLUGINS,
        toolbar: TOOLBARS[toolbar],
        toolbar_mode: 'sliding' as const,
        // The styles dropdown shows these labels; restrict to what an email
        // composer actually wants (skip pre, address, etc.).
        block_formats:
          'Paragraph=p; Heading 1=h1; Heading 2=h2; Heading 3=h3; ' +
          'Heading 4=h4; Blockquote=blockquote; Code=pre',
        // Tables — make them resemble email-friendly markup with width attrs.
        table_default_attributes: { border: '0', cellpadding: '8', cellspacing: '0' },
        table_default_styles: { 'border-collapse': 'collapse', width: '100%' },
        table_appearance_options: false,
        content_style: CONTENT_STYLE,
        // Email content frequently includes raw <table>, inline `style`
        // attributes, and other markup TipTap normalized away. Allow them.
        valid_elements: '*[*]',
        extended_valid_elements: '*[*]',
        forced_root_block: 'p' as const,
        setup: (ed: TinyMCEEditor) => {
          ed.ui.registry.addButton('assetimage', {
            icon: 'image',
            tooltip: 'Insert image from library',
            onAction: () => setPickerOpen(true),
          });
        },
      }),
      [toolbar, minHeight, height],
    );

    return (
      <>
        <TinyEditor
          licenseKey="gpl"
          onInit={(_evt, ed) => {
            editorRef.current = ed;
          }}
          value={value}
          onEditorChange={(html) => onChange(html)}
          init={init}
        />
        {pickerOpen && (
          <AssetPickerModal
            onClose={() => setPickerOpen(false)}
            onSelect={handleAssetPick}
          />
        )}
      </>
    );
  },
);
