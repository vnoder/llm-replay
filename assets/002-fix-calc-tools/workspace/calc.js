// 简单计算器（待修复）
function add(a, b) {
  return a - b; // bug: should be a + b
}

// TODO: add multiply(a, b)

// --- self test ---
const assert = require('node:assert');
assert.strictEqual(add(1, 2), 3);
assert.strictEqual(add(-1, 1), 0);
try {
  assert.strictEqual(multiply(3, 4), 12);
  assert.strictEqual(multiply(-2, 5), -10);
} catch (e) {
  console.error('multiply not implemented:', e.message);
  process.exit(1);
}
module.exports = { add };
console.log('PASS');
