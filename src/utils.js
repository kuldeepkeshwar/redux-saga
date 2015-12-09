

export function isGenerator(fn) {
  return fn.constructor.name === 'GeneratorFunction';
}

export function span(array, predicate) {
  const yes = [], no = []
  for (let i = 0; i < array.length; i++) {
    const item = array[i]
    if(predicate(item))
      yes.push(item)
    else
      no.push(item)
  }
  return [yes, no]
}
