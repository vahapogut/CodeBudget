import type * as TypeScriptApi from 'typescript';

export interface FunctionFacts { parameters: string[]; references: Set<string>; calls: { callee: string; args: string[] }[]; methodCalls: Set<string>; }
/** Code-only facts: comments and string contents are not AST identifiers or calls, so they never satisfy a constraint. */
export interface SourceFacts { functions: Map<string, FunctionFacts>; names: Set<string>; argumentsCallee: boolean; }
/** Trusted evaluator source, passed only to the local evaluator process, never to the runner. */
export interface HiddenEvaluator { assertions: string; constraint?: (facts: SourceFacts) => string | null; }

/** Parses with the lazily resolved TypeScript compiler API; no candidate code runs here. */
export function analyzeSource(ts: typeof TypeScriptApi, source: string): SourceFacts {
  const file = ts.createSourceFile('solution.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const functions = new Map<string, FunctionFacts>();
  const names = new Set<string>();
  let argumentsCallee = false;
  const factsOf = (node: TypeScriptApi.FunctionLikeDeclaration): FunctionFacts => {
    const facts: FunctionFacts = { parameters: node.parameters.map(parameter => ts.isIdentifier(parameter.name) ? parameter.name.text : ''), references: new Set(), calls: [], methodCalls: new Set() };
    const visit = (child: TypeScriptApi.Node): void => {
      const parent = child.parent;
      if (ts.isIdentifier(child) && !((ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) && parent.name === child)) facts.references.add(child.text);
      if (ts.isCallExpression(child)) {
        if (ts.isIdentifier(child.expression)) facts.calls.push({ callee: child.expression.text, args: child.arguments.map(argument => ts.isIdentifier(argument) ? argument.text : '') });
        else if (ts.isPropertyAccessExpression(child.expression)) facts.methodCalls.add(child.expression.name.text);
      }
      ts.forEachChild(child, visit);
    };
    ts.forEachChild(node, child => { if (child !== node.name) visit(child); });
    return facts;
  };
  const visit = (node: TypeScriptApi.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'arguments' && node.name.text === 'callee') argumentsCallee = true;
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      const facts = factsOf(node);
      // A named function expression is reachable both by its own name and by the variable it initializes.
      if (!ts.isArrowFunction(node) && node.name) functions.set(node.name.text, facts);
      if (!ts.isFunctionDeclaration(node) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) functions.set(node.parent.name.text, facts);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { functions, names, argumentsCallee };
}

/** Any cycle among named functions reachable from `start` (direct, mutual or through a helper) is recursion. */
export function reachesRecursion(facts: SourceFacts, start: string): boolean {
  const state = new Map<string, 'active' | 'done'>();
  const walk = (name: string): boolean => {
    const entry = facts.functions.get(name);
    if (!entry || state.get(name) === 'done') return false;
    if (state.get(name) === 'active') return true;
    state.set(name, 'active');
    for (const reference of entry.references) if (facts.functions.has(reference) && walk(reference)) return true;
    state.set(name, 'done');
    return false;
  };
  return walk(start);
}

// Regression-task evaluators pass one faulty candidate per required property, so a test that skips a property fails.
export const hiddenEvaluators: Readonly<Record<string, HiddenEvaluator>> = {
  'bug-01': { assertions: 'assert.equal(m.solve(-2, 0, 10), 0); assert.equal(m.solve(15, 0, 10), 10); assert.equal(m.solve(4, 0, 10), 4);' },
  'bug-02': { assertions: 'assert.deepEqual(m.solve([1,2,3,4,5], 2), [[1,2],[3,4],[5]]); assert.deepEqual(m.solve([], 2), []); assert.throws(() => m.solve([1], 0), RangeError);' },
  'bug-03': { assertions: 'assert.equal(m.solve(100, 0), 100); assert.equal(m.solve(100, 100), 0); assert.equal(m.solve(200, 25), 150);' },
  'bug-04': { assertions: 'assert.equal(m.solve({a:0,b:"",c:null,d:undefined,e:"a b"}), "a=0&b=&e=a+b");' },
  'bug-05': { assertions: 'assert.equal(m.solve(1900), false); assert.equal(m.solve(2000), true); assert.equal(m.solve(2024), true); assert.equal(m.solve(2023), false);' },
  'bug-06': { assertions: 'const x=[12,2,4,10]; assert.equal(m.solve(x),7); assert.deepEqual(x,[12,2,4,10]); assert.equal(m.solve([]),null); assert.equal(m.solve([9,1,3]),3);' },
  'type-01': { assertions: 'assert.equal(m.solve(null),"Anonymous"); assert.equal(m.solve("  "),"Anonymous"); assert.equal(m.solve(" Ada "),"Ada");' },
  'type-02': { assertions: 'assert.equal(m.solve({ok:true,value:9}),9); assert.equal(m.solve({ok:false,errorCode:3}),-3);' },
  'type-03': { assertions: 'const x=Object.freeze([10,2,1]); assert.deepEqual(m.solve(x),[1,2,10]);' },
  'type-04': { assertions: 'assert.deepEqual(m.solve({}),{x:0,y:0}); assert.deepEqual(m.solve({x:4}),{x:4,y:0}); assert.deepEqual(m.solve({x:2,y:3}),{x:2,y:3});' },
  'type-05': { assertions: 'assert.equal(await m.solve(4),8); assert.equal(await m.solve(-2),-4);' },
  'type-06': { assertions: 'assert.equal(m.solve({},"x"),"missing"); assert.equal(m.solve({x:"HELLO"},"x"),"hello"); assert.equal(m.solve({x:""},"x"),"");' },
  // Below, within and above the bounds; swapped and identity candidates remain.
  'reg-01': { assertions: 'assert.equal(m.regression((v,min,max)=>Math.max(min,Math.min(max,v))),true); assert.equal(m.regression((v,min,max)=>Math.min(min,Math.max(max,v))),false); assert.equal(m.regression(v=>v),false); assert.equal(m.regression((v,min,max)=>Math.min(max,v)),false); assert.equal(m.regression((v,min,max)=>Math.max(min,v)),false); assert.equal(m.regression((v,min,max)=>v<min?min:v>max?max:min),false);' },
  // Zero and nonzero discounts.
  'reg-02': { assertions: 'assert.equal(m.regression((p,d)=>p*(1-d/100)),true); assert.equal(m.regression((p,d)=>p*d/100),false); assert.equal(m.regression(p=>p),false); assert.equal(m.regression((p,d)=>d?p*(1-d/100):0),false);' },
  // Century non-leap, four-century leap, ordinary leap and ordinary non-leap years.
  'reg-03': { assertions: 'assert.equal(m.regression(y=>y%4===0&&(y%100!==0||y%400===0)),true); assert.equal(m.regression(y=>y%4===0),false); assert.equal(m.regression(y=>y%4===0&&y%100!==0),false); assert.equal(m.regression(y=>y%100===0?y%400===0:true),false); assert.equal(m.regression(y=>y%400===0),false);' },
  // Empty input must be exactly null; nonempty input must be the arithmetic mean.
  'reg-04': { assertions: 'assert.equal(m.regression(v=>v.length?v.reduce((a,b)=>a+b,0)/v.length:null),true); assert.equal(m.regression(v=>v.reduce((a,b)=>a+b,0)/v.length),false); assert.equal(m.regression(()=>null),false); assert.equal(m.regression(v=>v.length?v.reduce((a,b)=>a+b,0)/v.length:0),false); assert.equal(m.regression(v=>v.length?v.reduce((a,b)=>a+b,0)/v.length:undefined),false); assert.equal(m.regression(v=>v.length?v.reduce((a,b)=>a+b,0):null),false);' },
  // Numeric (not lexicographic) ascending order and an unmutated input.
  'reg-05': { assertions: 'assert.equal(m.regression(v=>[...v].sort((a,b)=>a-b)),true); assert.equal(m.regression(v=>[...v].sort()),false); assert.equal(m.regression(v=>v.sort((a,b)=>a-b)),false); assert.equal(m.regression(v=>[...v].sort((a,b)=>b-a)),false); assert.equal(m.regression(v=>[...v]),false);' },
  // Case-insensitive, whitespace-trimmed and able to report unequal strings.
  'reg-06': { assertions: 'assert.equal(m.regression((a,b)=>a.trim().toLowerCase()===b.trim().toLowerCase()),true); assert.equal(m.regression((a,b)=>a.toLowerCase()===b.toLowerCase()),false); assert.equal(m.regression(()=>true),false); assert.equal(m.regression((a,b)=>a.trim()===b.trim()),false); assert.equal(m.regression(()=>false),false);' },
  'ref-01': { assertions: 'assert.equal(m.normalizeName(" ADA "),"ada"); assert.equal(m.solve(" Ada "," LOVELACE "),"ada:lovelace");', constraint: facts => {
    const solve = facts.functions.get('solve');
    if (!solve || !facts.functions.has('normalizeName')) return 'solve and a normalizeName function are required';
    const [first, second] = solve.parameters;
    const normalized = solve.calls.filter(call => call.callee === 'normalizeName').map(call => call.args[0]);
    return first && second && normalized.includes(first) && normalized.includes(second) ? null : 'solve must call normalizeName for both inputs';
  } },
  'ref-02': { assertions: 'const x=[8,1,4,2,6]; assert.deepEqual(m.solve(x),[1,2,4]); assert.deepEqual(x,[8,1,4,2,6]);' },
  'ref-03': { assertions: 'assert.equal(m.solve(0),1); assert.equal(m.solve(5),120); assert.equal(m.solve(15),1307674368000);', constraint: facts => reachesRecursion(facts, 'solve') || facts.argumentsCallee ? 'solve must not recurse' : null },
  'ref-04': { assertions: 'assert.equal(m.isValid("  "),false); assert.equal(m.isValid(" a "),true); assert.deepEqual(m.solve(["", " a ", " ", "b"]),[" a ","b"]);', constraint: facts => facts.functions.has('isValid') && facts.functions.get('solve')?.references.has('isValid') ? null : 'solve must use the isValid helper' },
  'ref-05': { assertions: 'const u={name:"A",nickname:undefined,profile:{active:true}}; const v=m.solve(u); assert.ok(Object.hasOwn(v,"nickname")); v.profile.active=false; assert.equal(u.profile.active,true);', constraint: facts => facts.names.has('JSON') ? 'JSON serialization must not be used for cloning' : null },
  'ref-06': { assertions: 'assert.equal(m.solve(["a","","b","c"]),"a/b/c"); assert.equal(m.solve([]),"");', constraint: facts => facts.functions.get('solve')?.methodCalls.has('join') ? null : 'solve must build its result with an array join' },
  'log-01': { assertions: 'assert.equal(m.solve(),"DB_CONNECTION_REFUSED");' },
  'log-02': { assertions: 'assert.equal(m.solve(),"b");' },
  'log-03': { assertions: 'assert.equal(m.solve(),"src/checkout.ts:27");' },
  'log-04': { assertions: 'assert.equal(m.solve(),"billing > rejects negative credit");' },
  'log-05': { assertions: 'assert.equal(m.solve(),"WRITE_FAILED");' },
  'log-06': { assertions: 'assert.equal(m.solve(),8);' },
};
