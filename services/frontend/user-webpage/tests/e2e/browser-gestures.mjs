export const UNPREVENTED_BROWSER_GESTURES = {
  ctrlWheel: false,
  metaWheel: false,
  horizontalWheel: false,
  edgeSwipe: false,
  pinch: false,
};

// Check application listeners, not OS/browser-chrome gesture recognition.
export async function preventedBrowserGestures(target) {
  return target.evaluate((element) => {
    const send = (event) => {
      element.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const wheel = (options) =>
      new globalThis.WheelEvent("wheel", { bubbles: true, cancelable: true, ...options });
    const touch = (type, touches) => {
      const event = new globalThis.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        touches: { value: touches },
        changedTouches: { value: touches },
      });
      return event;
    };
    const ctrlWheel = send(wheel({ ctrlKey: true, deltaY: -40 }));
    const metaWheel = send(wheel({ metaKey: true, deltaY: -40 }));
    const horizontalWheel = send(wheel({ deltaX: -100 }));
    send(touch("touchstart", [{ clientX: 1, clientY: 100 }]));
    const edgeSwipe = send(touch("touchmove", [{ clientX: 70, clientY: 100 }]));
    const pinch = send(
      touch("touchmove", [
        { clientX: 80, clientY: 100 },
        { clientX: 200, clientY: 100 },
      ]),
    );
    return { ctrlWheel, metaWheel, horizontalWheel, edgeSwipe, pinch };
  });
}
