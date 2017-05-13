import { is, check, remove, MATCH, internalErr, SAGA_ACTION } from './utils'
import { buffers } from './buffers'
import { asap } from './scheduler'

const CHANNEL_END_TYPE = '@@redux-saga/CHANNEL_END'
export const END = {type: CHANNEL_END_TYPE}
export const isEnd = a => a && a.type === CHANNEL_END_TYPE


export const INVALID_BUFFER = 'invalid buffer passed to channel factory function'
export let UNDEFINED_INPUT_ERROR = 'Saga was provided with an undefined action'

if (process.env.NODE_ENV !== 'production') {
  UNDEFINED_INPUT_ERROR += `\nHints:
    - check that your Action Creator returns a non-undefined value
    - if the Saga was started using runSaga, check that your subscribe source provides the action to its listeners
  `
}

export function channel(buffer = buffers.fixed()) {
  let closed = false
  let takers = []

  check(buffer, is.buffer, INVALID_BUFFER)

  function checkForbiddenStates() {
    if(closed && takers.length) {
      throw internalErr()
    }
    if(takers.length && !buffer.isEmpty()) {
      throw internalErr('Cannot have pending takers with non empty buffer')
    }
  }

  function put(input) {
    checkForbiddenStates()
    check(input, is.notUndef, UNDEFINED_INPUT_ERROR)
    if (closed) {
      return
    }
    if (!takers.length) {
      return buffer.put(input)
    }
    for (var i = 0; i < takers.length; i++) {
      const cb = takers[i]
      if(!cb[MATCH] || cb[MATCH](input)) {
        takers.splice(i, 1)
        return cb(input)
      }
    }
  }

  function take(cb) {
    checkForbiddenStates()
    check(cb, is.func, 'channel.take\'s callback must be a function')

    if(closed && buffer.isEmpty()) {
      cb(END)
    } else if(!buffer.isEmpty()) {
      cb(buffer.take())
    } else {
      takers.push(cb)
      cb.cancel = () => remove(takers, cb)
    }
  }

  function flush(cb) {
    checkForbiddenStates() // TODO: check if some new state should be forbidden now
    check(cb, is.func, 'channel.flush\' callback must be a function')
    if (closed && buffer.isEmpty()) {
      cb(END)
      return
    }
    cb(buffer.flush())
  }

  function close() {
    checkForbiddenStates()
    if(!closed) {
      closed = true
      if(takers.length) {
        const arr = takers
        takers = []
        for (let i = 0, len = arr.length; i < len; i++) {
          arr[i](END)
        }
      }
    }
  }

  return {take, put, flush, close,
    get __takers__() { return takers },
    get __closed__() { return closed }
  }
}

export function eventChannel(subscribe, buffer = buffers.none(), matcher) {
  /**
    should be if(typeof matcher !== undefined) instead?
    see PR #273 for a background discussion
  **/
  if(arguments.length > 2) {
    check(matcher, is.func, 'Invalid match function passed to eventChannel')
  }

  const chan = channel(buffer)
  const close = () => {
    if(!chan.__closed__) {
      if (unsubscribe) {
        unsubscribe()
      }
      chan.close()
    }
  }
  const unsubscribe = subscribe(input => {
    //
    if(isEnd(input)) {
      close()
      return
    }
    if(matcher && !matcher(input)) {
      return
    }
    chan.put(input)
  })
  if (chan.__closed__) {
    unsubscribe()
  }

  if(!is.func(unsubscribe)) {
    throw new Error('in eventChannel: subscribe should return a function to unsubscribe')
  }

  return {
    take: chan.take,
    flush: chan.flush,
    close
  }
}

export function multicast() {
  const chan = channel(buffers.none())
  let putLock = false
  let pendingTakers = []
  return {
    ...chan,
    put(input) {
      // TODO: should I check forbidden state here? 1 of them is even impossible
      // as we do not possibility of buffer here
      check(input, is.notUndef, UNDEFINED_INPUT_ERROR)
      if (chan.__closed__) {
        return
      }
      const takers = chan.__takers__
      putLock = true
      for (var i = 0; i < takers.length; i++) {
        const cb = takers[i]
        if(!cb[MATCH] || cb[MATCH](input) || isEnd(input)) {
          takers.splice(i, 1)
          cb(input)
          i--
        }
      }
      putLock = false

      pendingTakers.forEach(chan.take)
      pendingTakers = []
    },
    take(cb) {
      if (putLock) {
        pendingTakers.push(cb)
        cb.cancel = () => remove(pendingTakers, cb)
        return
      }
      chan.take(cb)
    }
  }
}

export function createStdChannel() {
  const chan = multicast()
  return {
    ...chan,
    // TODO: how runSaga can benefit from this scheduling fix?
    // maybe it should detect if passed channel is std and wrap with the fix if neccessary
    // createStdChannel could be replaced with `stdChannel(multicast)`
    // auto wrapping would mutate passed in reference though :/
    put(input) {
      if (input[SAGA_ACTION]) {
        chan.put(input)
        return
      }
      asap(() => chan.put(input))
    },
    // TODO: rethink the matcher, seems hacky
    // how matcher applies to runSaga now?
    take(cb, matcher) {
      if(arguments.length > 1) {
        check(matcher, is.func, 'channel.take\'s matcher argument must be a function')
        cb[MATCH] = matcher
      }
      chan.take(cb)
    }
  }
}
