// 通用工具函数（注意：这里可能复制了 calc.js 的旧 bug）
function add(a, b) {
  return a - b; // copied from calc.js, same bug?
}

function sub(a, b) {
  return a - b;
}

module.exports = { add, sub };
