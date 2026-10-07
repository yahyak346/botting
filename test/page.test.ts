import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffPage, htmlToText, snapshotPage } from '../src/monitors/page.ts';

const cfg = { name: 'Test page', url: 'https://shop.test/p' };

test('htmlToText strips scripts, styles and tags', () => {
  const html = '<style>.a{}</style><p>Hello&nbsp;<b>world</b></p><script>var x = "Sold out"</script>';
  assert.equal(htmlToText(html), 'Hello world');
});

test('keyword inside a script does not count as a match', () => {
  assert.equal(snapshotPage('<script>"Add to cart"</script><p>Sold out</p>', 'add to cart').matched, false);
});

test('appears mode fires once when the keyword shows up', () => {
  const prev = snapshotPage('<button>Sold out</button>', 'Add to cart');
  const next = snapshotPage('<button>Add to cart</button>', 'Add to cart');
  const c = { ...cfg, keyword: 'Add to cart', pageMode: 'appears' as const };
  assert.equal(diffPage(prev, next, c)[0]?.type, 'page_match');
  assert.deepEqual(diffPage(next, next, c), []);
});

test('disappears mode fires when the keyword goes away', () => {
  const prev = snapshotPage('<p>Sold out</p>', 'sold out');
  const next = snapshotPage('<p>In stock</p>', 'sold out');
  const events = diffPage(prev, next, { ...cfg, keyword: 'sold out', pageMode: 'disappears' });
  assert.equal(events[0]?.type, 'page_match');
});

test('changes mode ignores markup-only changes', () => {
  const prev = snapshotPage('<div class="a">Hi</div>', undefined);
  const same = snapshotPage('<span class="b">Hi</span>', undefined);
  const diff = snapshotPage('<div>Bye</div>', undefined);
  assert.deepEqual(diffPage(prev, same, cfg), []);
  assert.equal(diffPage(prev, diff, cfg)[0]?.type, 'page_change');
});
