/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Autocorrect
 * CVM-Role:        Utility Function
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This is the autocorrect plugin, but since it basically just
 *                  consists of commands, we added it to the commands folder.
 *
 * END HEADER
 */

// The autocorrect plugin is basically just a keymap that listens to spaces and enters
import { syntaxTree } from '@codemirror/language'
import { ChangeSpec, EditorSelection, EditorState } from '@codemirror/state'
import { Command, EditorView } from '@codemirror/view'
import { configField } from '../util/configuration'

// These characters can be directly followed by a starting magic quote
const startChars = ' ([{-–—'

/**
 * Given the editor state and a position, this function returns whether the
 * position sits within a node that is protected from autocorrect. In those
 * cases, no autocorrection will be applied, regardless of whether there is a
 * suitable candidate.
 *
 * @param   {EditorState}  state  The state
 * @param   {number}       pos    The position to check
 *
 * @return  {boolean}             True if the position touches a protected node.
 */
function posInProtectedNode (state: EditorState, pos: number): boolean {
  const node = syntaxTree(state).resolve(pos, 0)
  console.log(node.type.name)
  return [
    'InlineCode', // `code`
    'CommentBlock', // <!-- comment -->
    'FencedCode', // Code block
    'CodeText', // Code block
    'HorizontalRule'
  ].includes(node.type.name)
}

/**
 * If AutoCorrect is active, this handles a (potential) replacement on Space or
 * Enter.
 *
 * @param   {EditorView}  view  The editor's view
 *
 * @return  {boolean}           Always returns false to make Codemirror add the Space/Enter
 */
export function handleReplacement (view: EditorView): boolean {
  const autocorrect = view.state.field(configField).autocorrect
  if (!autocorrect.active || autocorrect.replacements.length === 0) {
    return false
  }

  // Make a deep copy of the autocorrect (to not mess with the order), sort by
  // key length descending.
  const replacements = autocorrect.replacements.map(e => { return { ...e } })
  replacements.sort((a, b) => b.key.length - a.key.length)

  const maxKeyLength = replacements[0].key.length
  const changes: ChangeSpec[] = []

  for (const range of view.state.selection.ranges) {
    // Ignore selections (only cursors)
    if (!range.empty) {
      continue
    }

    // Ignore those cursors that are inside protected nodes
    if (posInProtectedNode(view.state, range.from)) {
      continue
    }

    // Leave --- and ... lines (YAML frontmatter as well as horizontal rules)
    const line = view.state.doc.lineAt(range.from)
    if ([ '---', '...' ].includes(line.text)) {
      continue
    }

    const from = Math.max(range.from - maxKeyLength, 0)
    const slice = view.state.sliceDoc(from, range.from)
    for (const { key, value } of replacements) {
      if (slice.endsWith(key)) {
        const startOfReplacement = range.from - key.length
        if (posInProtectedNode(view.state, startOfReplacement)) {
          break // `range.from` may not be in a protected area, but start is.
        }

        changes.push({ from: startOfReplacement, to: range.from, insert: value })
        break // Do not check the other possible replacements
      }
    }
  }

  view.dispatch({ changes })

  // Indicate that we did not handle the key, making Codemirror add the key
  return false
}

/**
 * Handles backspace presses that turn magic quotes into regular quotes
 *
 * @param   {EditorView}  view  The editor view
 *
 * @return  {boolean}           Whether the function has replaced a quote
 */
export function handleBackspace (view: EditorView): boolean {
  const autocorrect = view.state.field(configField).autocorrect
  if (!autocorrect.active) {
    return false
  }

  const primaryMagicQuotes = autocorrect.magicQuotes.primary.split('…')
  const secondaryMagicQuotes = autocorrect.magicQuotes.secondary.split('…')

  // This checks if we have a magic quote right before the cursor. If so,
  // pressing Backspace will not remove the quote, but rather replace it with a
  // simple " or ' quote.
  const changes: ChangeSpec[] = []
  let hasHandled = false

  for (const range of view.state.selection.ranges) {
    if (range.from === 0) {
      continue
    }

    const slice = view.state.sliceDoc(range.from - 1, range.from)
    if (primaryMagicQuotes.includes(slice) && slice !== '"') {
      hasHandled = true
      changes.push({ from: range.from - 1, to: range.from, insert: '"' })
    } else if (secondaryMagicQuotes.includes(slice) && slice !== "'") {
      hasHandled = true
      changes.push({ from: range.from - 1, to: range.from, insert: "'" })
    }
  }

  view.dispatch({ changes })
  return hasHandled // If we've replaced a quote, we must stop Codemirror from removing it
}

/**
 * Adds magic quotes instead of simple quotes, if applicable
 *
 * @param   {string}  quote  The quote to replace, either ' or "
 *
 * @return  {Command}        Returns a Command function
 */
export function handleQuote (quote: string): Command {
  return function (view: EditorView): boolean {
    const autocorrect = view.state.field(configField).autocorrect
    if (!autocorrect.active) {
      return false
    }

    const primary = autocorrect.magicQuotes.primary.split('…')
    const secondary = autocorrect.magicQuotes.secondary.split('…')
    const quotes = (quote === '"') ? primary : secondary

    const transaction = view.state.changeByRange((range) => {
      if (range.empty) {
        // Check the character before and insert an appropriate quote
        const charBefore = view.state.sliceDoc(range.from - 1, range.from)
        const insert = startChars.includes(charBefore) ? quotes[0] : quotes[1]
        return {
          range: EditorSelection.cursor(range.to + insert.length),
          changes: {
            from: range.from,
            to: range.to,
            insert
          }
        }
      } else {
        // Surround the selection with quotes
        const text = view.state.sliceDoc(range.from, range.to)
        return {
          range: EditorSelection.range(range.from + quotes[0].length, range.to + quotes[1].length),
          changes: { from: range.from, to: range.to, insert: `${quotes[0]}${text}${quotes[1]}` }
        }
      }
    })

    view.dispatch(transaction)

    return true
  }
}
