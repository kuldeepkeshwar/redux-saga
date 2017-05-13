import test from 'tape';
import { createStore, applyMiddleware } from 'redux'
import sagaMiddleware from '../../src'
import proc from '../../src/internal/proc'
import { channel, END } from '../../src/internal/channel'
import * as io from '../../src/effects'

test('processor take from default channel', assert => {
  assert.plan(1);

  const middleware = sagaMiddleware()
  const store = applyMiddleware(middleware)(createStore)(() => {})

  const typeSymbol = Symbol('action-symbol');

  let actual = [];

  function* genFn() {
    try {
      actual.push( yield io.take() ) // take all actions
      actual.push( yield io.take('action-1') ) // take only actions of type 'action-1'
      actual.push( yield io.take(['action-2', 'action-2222']) ) // take either type
      actual.push( yield io.take(a => a.isAction) ) // take if match predicate
      actual.push( yield io.take(['action-3', a => a.isMixedWithPredicate]) ) // take if match any from the mixed array
      actual.push( yield io.take(['action-3', a => a.isMixedWithPredicate]) ) // take if match any from the mixed array
      actual.push( yield io.take(typeSymbol) ) // take only actions of a Symbol type
      actual.push( yield io.take('never-happening-action') ) //  should get END
      // TODO: never-happening-action replaced with such case is not working
      // END is not handled properly on channels?
      // const chan = channel()
      // actual.push( yield io.take(chan) ) //  should get END
    } finally {
      actual.push('auto ended')
    }
  }

  middleware.run(genFn).done.catch(err => assert.fail(err))

  Promise.resolve(1)
      .then(() => store.dispatch({type: 'action-*'}))
      .then(() => store.dispatch({type: 'action-1'}))
      .then(() => store.dispatch({type: 'action-2'}))
      .then(() => store.dispatch({type: 'unnoticeable-action'}))
      .then(() => store.dispatch({type: '', isAction: true}))
      .then(() => store.dispatch({type: '', isMixedWithPredicate: true}))
      .then(() => store.dispatch({type: 'action-3'}))
      .then(() => store.dispatch({type: typeSymbol}))
      .then(() => store.dispatch({...END, timestamp: Date.now()})) // see #316
      .then(() => {
        const expected = [{type: 'action-*'}, {type: 'action-1'}, {type: 'action-2'}, {type: '', isAction: true},
          {type: '', isMixedWithPredicate: true}, {type: 'action-3'}, {type: typeSymbol}, 'auto ended'];

        assert.deepEqual(actual, expected,
          "processor must fullfill take Effects from default channel"
        );
        assert.end();
      })
});

test('processor take from provided channel', assert => {
  assert.plan(1);

  const chan = channel()
  let actual = [];

  Promise.resolve()
    .then(() => chan.put(1))
    .then(() => chan.put(2))
    .then(() => chan.put(3))
    .then(() => chan.put(4))
    .then(() => chan.close())


  function* genFn() {
    actual.push( yield io.take.maybe(chan) )
    actual.push( yield io.take.maybe(chan) )
    actual.push( yield io.take.maybe(chan) )
    actual.push( yield io.take.maybe(chan) )
    actual.push( yield io.take.maybe(chan) )
    actual.push( yield io.take.maybe(chan) )
  }

  proc(genFn()).done.catch(err => assert.fail(err))

  const expected = [1, 2, 3, 4, END, END];

  setTimeout(() => {
    assert.deepEqual(actual, expected,
      "processor must fullfill take Effects from a provided channel"
    );
    assert.end();
  }, 0)

});
