import { Extension } from '@tiptap/core';
import Suggestion from '@tiptap/suggestion';
import React, { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import VideoFinderPanel from './VideoFinderPanel.jsx';

// getVideos: a function that returns the current video list (use a ref getter to stay fresh)
export function buildVideoFinderExtension(getVideos) {
  return Extension.create({
    name: 'videoFinder',

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '/',
          allowSpaces: true,
          startOfLine: false,

          items({ query }) {
            const q = query.toLowerCase().trim();
            const videos = (typeof getVideos === 'function' ? getVideos() : getVideos) || [];
            if (!q) return videos.slice(0, 12);
            return videos
              .filter((v) => {
                const title = (v.title || '').toLowerCase();
                const username = (v.accountUsername || '').toLowerCase();
                return title.includes(q) || username.includes(q);
              })
              .slice(0, 12);
          },

          command({ editor, range, props: video }) {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: 'socialVideoBlock',
                attrs: {
                  url: video.url,
                  videoId: video.id,
                  platform: video.platform,
                  status: 'ready',
                },
              })
              .run();
          },

          render() {
            let panelRef;
            let root;
            let container;

            return {
              onStart(props) {
                container = document.createElement('div');
                document.body.appendChild(container);
                panelRef = createRef();
                root = createRoot(container);
                root.render(
                  React.createElement(VideoFinderPanel, {
                    ref: panelRef,
                    items: props.items,
                    command: props.command,
                    clientRect: props.clientRect,
                    query: props.query,
                  })
                );
              },

              onUpdate(props) {
                root.render(
                  React.createElement(VideoFinderPanel, {
                    ref: panelRef,
                    items: props.items,
                    command: props.command,
                    clientRect: props.clientRect,
                    query: props.query,
                  })
                );
              },

              onKeyDown(props) {
                if (props.event.key === 'Escape') {
                  this.onExit();
                  return true;
                }
                return panelRef?.current?.onKeyDown(props) ?? false;
              },

              onExit() {
                root.unmount();
                container.remove();
              },
            };
          },
        }),
      ];
    },
  });
}
