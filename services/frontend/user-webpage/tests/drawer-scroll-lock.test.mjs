import assert from "node:assert/strict";
import test from "node:test";
import { drawerScrollLockRef } from "../src/drawer-scroll-lock.ts";

/** A document root that loses its scrollbar gutter (if any) while locked. */
function page(gutter) {
  const attributes = new Set();
  const properties = new Map();
  const root = {
    setAttribute: (name) => attributes.add(name),
    removeAttribute: (name) => attributes.delete(name),
    getBoundingClientRect: () => ({
      width: attributes.has("data-drawer-scroll-lock") ? 1440 : 1440 - gutter,
    }),
    style: {
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: (name) => properties.delete(name),
    },
  };
  const content = () => ({ ownerDocument: { documentElement: root } });
  return { attributes, properties, content };
}

test("the first drawer locks the page and pads it by the released scrollbar gutter", () => {
  const { attributes, properties, content } = page(15);
  const release = drawerScrollLockRef(content());
  assert.deepEqual([...attributes], ["data-drawer-scroll-lock"]);
  assert.equal(properties.get("--ui-scrollbar-gutter"), "15px");
  release();
  assert.equal(attributes.size, 0);
  assert.equal(properties.size, 0);
});

test("overlay scrollbars release no gutter", () => {
  const { properties, content } = page(0);
  const release = drawerScrollLockRef(content());
  assert.equal(properties.get("--ui-scrollbar-gutter"), "0px");
  release();
});

test("nested drawers keep the first measurement until the last one unmounts", () => {
  const { attributes, properties, content } = page(15);
  const releaseOuter = drawerScrollLockRef(content());
  // Already locked: measuring again would find no gutter and drop the padding.
  const releaseInner = drawerScrollLockRef(content());
  assert.equal(properties.get("--ui-scrollbar-gutter"), "15px");
  releaseOuter();
  assert.ok(attributes.has("data-drawer-scroll-lock"));
  assert.equal(properties.get("--ui-scrollbar-gutter"), "15px");
  releaseInner();
  assert.equal(attributes.size, 0);
  assert.equal(properties.size, 0);
});

test("an unmounted ref leaves the page unlocked", () => {
  assert.equal(drawerScrollLockRef(null), undefined);
});
