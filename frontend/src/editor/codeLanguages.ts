/**
 * 围栏代码块语法高亮用的语言清单。
 *
 * 刻意从 @codemirror/language-data 的 143 种语言里挑选常用子集：
 * 全量清单会让 vite 为每种语言产出一个懒加载 chunk（构建产物膨胀），
 * 而真实笔记里出现的语言基本落在下面这些。
 */
import { languages } from '@codemirror/language-data'

const WANTED = new Set([
  'JavaScript',
  'JSX',
  'TypeScript',
  'TSX',
  'JSON',
  'HTML',
  'XML',
  'CSS',
  'LESS',
  'Sass',
  'SCSS',
  'Markdown',
  'Python',
  'Java',
  'C',
  'C++',
  'C#',
  'Go',
  'Rust',
  'PHP',
  'Ruby',
  'Kotlin',
  'Swift',
  'Scala',
  'Shell',
  'PowerShell',
  'Dockerfile',
  'TOML',
  'YAML',
  'SQL',
  'MySQL',
  'PostgreSQL',
  'ProtoBuf',
  'Diff',
  'diff',
  'Lua',
  'R',
  'Dart',
  'Vue',
  'Properties files',
])

export const codeLanguages = languages.filter((l) => WANTED.has(l.name))
