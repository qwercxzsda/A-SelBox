import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/api/transport.ts";
import { saveError, saveErrorText } from "../src/save-error.ts";

test("a failed save is titled by its change and gives the cause like a failed read", () => {
  assert.deepEqual(saveError("save the assignment", new ApiError("Save assignment", 500)), {
    title: "Could not save the assignment",
    detail: "The server returned HTTP 500.",
  });
  assert.deepEqual(saveError("add the company", new ApiError("Create company", null, true)), {
    title: "Could not add the company",
    detail: "The request timed out.",
  });
});

test("an error's own sentence ends with one period, and a known reason replaces the cause", () => {
  assert.equal(
    saveError("save the assignment", new Error("A valid company ID is required")).detail,
    "A valid company ID is required.",
  );
  assert.equal(
    saveError("save the membership", new ApiError("Save membership", 409), "Changed.").detail,
    "Changed.",
  );
});

test("the one-line form joins the title and the cause as sentences", () => {
  assert.equal(
    saveErrorText(saveError("delete the company", new ApiError("Delete company", 503))),
    "Could not delete the company. The server returned HTTP 503.",
  );
});
