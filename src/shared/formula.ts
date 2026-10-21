import type { Issue, Project } from './types'

// Formula columns. Grammar:
//   expr    := compare
//   compare := add ((< | > | <= | >= | = | <>) add)*
//   add     := mul ((+ | -) mul)*
//   mul     := pow ((* | / | %) pow)*
//   pow     := unary (^ pow)?
//   unary   := (- | +) unary | primary
//   primary := number | column | FUNC '(' args ')' | '(' expr ')'
// Functions: SUM, MIN, MAX, AVG, ABS, ROUND(x[, digits]), IF(cond, then, else).
// Column names are matched case-insensitively, longest name first, so names may contain spaces.
// Formula columns may reference other formula columns. Depth is capped to stop cycles.

const MAX_DEPTH = 5
const FUNCS = new Set(['SUM', 'MIN', 'MAX', 'AVG', 'ABS', 'ROUND', 'IF'])

type Tok = { t: 'num'; v: number } | { t: 'ref'; v: string } | { t: 'fn'; v: string } | { t: 'op'; v: string }

class FormulaError extends Error {}

function tokenize(src: string, names: string[]): Tok[] {
  const out: Tok[] = []
  let i = 0
  const lower = src.toLowerCase()
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const name = names.find(n => lower.startsWith(n.toLowerCase(), i))
    if (name) {
      out.push({ t: 'ref', v: name })
      i += name.length
      continue
    }
    const num = /^\d+(\.\d+)?/.exec(src.slice(i))
    if (num) {
      out.push({ t: 'num', v: Number(num[0]) })
      i += num[0].length
      continue
    }
    const ident = /^[A-Za-z_]+/.exec(src.slice(i))
    if (ident) {
      const up = ident[0].toUpperCase()
      if (!FUNCS.has(up)) throw new FormulaError(`Unknown name ${ident[0]}`)
      out.push({ t: 'fn', v: up })
      i += ident[0].length
      continue
    }
    const two = src.slice(i, i + 2)
    if (two === '<=' || two === '>=' || two === '<>') {
      out.push({ t: 'op', v: two })
      i += 2
      continue
    }
    if ('+-*/%^<>=(),'.includes(ch)) {
      out.push({ t: 'op', v: ch })
      i++
      continue
    }
    throw new FormulaError(`Unexpected ${ch}`)
  }
  return out
}

// Evaluates a formula for one issue. Returns undefined on any syntax or reference error.
export function evaluateFormula(expr: string, issue: Issue, project: Project, depth = 0): number | undefined {
  if (depth > MAX_DEPTH) return undefined
  const cols = project.columns.filter(c => c.type === 'number' || c.type === 'progress' || c.type === 'formula' || c.type === 'checkbox')
  const names = cols.map(c => c.name).sort((a, b) => b.length - a.length)
  try {
    const toks = tokenize(expr, names)
    let pos = 0
    const peek = () => toks[pos]
    const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v
    const expect = (v: string) => {
      if (!isOp(v)) throw new FormulaError(`Expected ${v}`)
      pos++
    }

    const refValue = (name: string): number => {
      const col = cols.find(c => c.name === name)!
      if (col.type === 'formula') return col.formula ? evaluateFormula(col.formula, issue, project, depth + 1) ?? NaN : NaN
      const v = issue.values[col.id]
      if (typeof v === 'number') return v
      if (typeof v === 'boolean') return v ? 1 : 0
      return 0
    }

    const primary = (): number => {
      const tok = toks[pos++]
      if (!tok) throw new FormulaError('Unexpected end')
      if (tok.t === 'num') return tok.v
      if (tok.t === 'ref') return refValue(tok.v)
      if (tok.t === 'op' && tok.v === '(') {
        const v = compare()
        expect(')')
        return v
      }
      if (tok.t === 'fn') {
        expect('(')
        const args: number[] = []
        if (!isOp(')')) {
          args.push(compare())
          while (isOp(',')) {
            pos++
            args.push(compare())
          }
        }
        expect(')')
        return callFn(tok.v, args)
      }
      throw new FormulaError('Unexpected token')
    }

    const unary = (): number => {
      if (isOp('-')) {
        pos++
        return -unary()
      }
      if (isOp('+')) {
        pos++
        return unary()
      }
      return primary()
    }

    const pow = (): number => {
      const base = unary()
      if (isOp('^')) {
        pos++
        return base ** pow()
      }
      return base
    }

    const mul = (): number => {
      let v = pow()
      while (isOp('*') || isOp('/') || isOp('%')) {
        const op = (toks[pos++] as { v: string }).v
        const rhs = pow()
        v = op === '*' ? v * rhs : op === '/' ? (rhs === 0 ? 0 : v / rhs) : rhs === 0 ? 0 : v % rhs
      }
      return v
    }

    const add = (): number => {
      let v = mul()
      while (isOp('+') || isOp('-')) {
        const op = (toks[pos++] as { v: string }).v
        const rhs = mul()
        v = op === '+' ? v + rhs : v - rhs
      }
      return v
    }

    function compare(): number {
      let v = add()
      while (['<', '>', '<=', '>=', '=', '<>'].some(o => isOp(o))) {
        const op = (toks[pos++] as { v: string }).v
        const rhs = add()
        const hit = op === '<' ? v < rhs : op === '>' ? v > rhs : op === '<=' ? v <= rhs : op === '>=' ? v >= rhs : op === '=' ? v === rhs : v !== rhs
        v = hit ? 1 : 0
      }
      return v
    }

    const result = compare()
    if (pos !== toks.length) throw new FormulaError('Trailing tokens')
    return Number.isFinite(result) ? result : undefined
  } catch {
    return undefined
  }
}

function callFn(name: string, args: number[]): number {
  const nums = args
  switch (name) {
    case 'SUM':
      return nums.reduce((a, b) => a + b, 0)
    case 'AVG':
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
    case 'MIN':
      return nums.length ? Math.min(...nums) : 0
    case 'MAX':
      return nums.length ? Math.max(...nums) : 0
    case 'ABS':
      return Math.abs(nums[0] ?? 0)
    case 'ROUND': {
      const digits = nums[1] ?? 0
      const f = 10 ** digits
      return Math.round((nums[0] ?? 0) * f) / f
    }
    case 'IF':
      return nums[0] ? (nums[1] ?? 0) : (nums[2] ?? 0)
  }
  throw new FormulaError(`Unknown function ${name}`)
}
