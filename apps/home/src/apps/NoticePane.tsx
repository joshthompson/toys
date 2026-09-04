/**
 * The nearest thing Josh's Computer has to an error dialog: a window with something
 * to say and nothing to do about it. Used for files it won't take and files it can't
 * open — anywhere a real desktop would have beeped at you.
 */
export function NoticePane(props: { body: string }) {
  return (
    <div class="notice-pane">
      <span class="notice-glyph" aria-hidden="true">
        ⚠️
      </span>
      <p class="notice-body">{props.body}</p>
    </div>
  );
}
