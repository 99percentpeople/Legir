import type { Dispatch, ReactNode } from "react";
import { MessageSquare } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import {
  INTRO,
  PAGE_TITLES,
  PARAGRAPH,
  QUOTE,
  type DemoAction,
  type DemoState,
} from "./types";
import type { DemoCopy } from "./copy";

/** One document for both the reading surface and its live HTML thumbnails. */
export function DemoDocumentContent({
  state,
  copy,
  dispatch,
  thumbnail = false,
  quote,
}: {
  state: DemoState;
  copy: DemoCopy;
  dispatch?: Dispatch<DemoAction>;
  thumbnail?: boolean;
  quote?: ReactNode;
}) {
  const { t, effectiveLanguage } = useLanguage();
  const FormContainer = thumbnail ? "div" : "fieldset";
  return (
    <>
      <div className="demo-paper-top">
        <span>LEGIR / READING NOTES</span>
      </div>
      <p className="demo-paper-eyebrow">A LITTLE SPACE TO THINK</p>
      <h3>{PAGE_TITLES[state.page - 1]}</h3>
      {state.page === 1 && (
        <>
          <p className="demo-paper-intro" data-demo-excerpt="intro">
            {INTRO}
          </p>
          <div className="demo-paper-grid">
            <div>
              <small>01 READ</small>
              <span>A moment to pause.</span>
            </div>
            <div>
              <small>02 ANNOTATE</small>
              <span>A thought to keep.</span>
            </div>
            <div>
              <small>03 CONTINUE</small>
              <span>A little more clarity.</span>
            </div>
          </div>
          <h4>01 / The art of paying attention</h4>
          <p className="demo-paper-paragraph" data-demo-excerpt="paragraph">
            {PARAGRAPH}
          </p>
          <p className="demo-paper-quote" data-demo-excerpt="quote">
            {quote ?? <mark data-active={state.highlighted}>{QUOTE}</mark>}
            {state.highlighted && (
              <MessageSquare
                className="demo-margin-note"
                size={14}
                aria-hidden="true"
              />
            )}
          </p>
          <p className="demo-paper-paragraph">
            Highlight a passage. Leave a note. Return to what matters.
            <br />
            Your document stays on your device while you work.
          </p>
          <div className="demo-paper-closing">
            <h5>One document. A clearer train of thought.</h5>
            <p>
              The next page is a review form. Give your ideas a place to stay.
            </p>
          </div>
        </>
      )}
      {state.page === 2 && (
        <>
          <p className="demo-paper-intro">
            An interactive review form, right inside your PDF.
          </p>
          <FormContainer
            className="demo-document-form"
            lang={effectiveLanguage}
          >
            {!thumbnail && (
              <legend className="sr-only">{t("sidebar.fields")}</legend>
            )}
            {(["name", "email", "note"] as const).map((field) => (
              <div className="demo-form-field" key={field}>
                <label htmlFor={thumbnail ? undefined : `demo-${field}`}>
                  {copy[field]}
                </label>
                {thumbnail ? (
                  <div
                    className={`demo-form-value ${field === "note" ? "demo-form-multiline" : ""}`}
                  >
                    {state.fields[field]}
                  </div>
                ) : field === "note" ? (
                  <textarea
                    id="demo-note"
                    maxLength={500}
                    rows={3}
                    value={state.fields.note}
                    onChange={(event) =>
                      dispatch?.({
                        type: "field",
                        field,
                        value: event.target.value,
                      })
                    }
                  />
                ) : (
                  <input
                    id={`demo-${field}`}
                    type={field === "email" ? "email" : "text"}
                    autoComplete="off"
                    maxLength={field === "email" ? 160 : 80}
                    value={state.fields[field]}
                    onChange={(event) =>
                      dispatch?.({
                        type: "field",
                        field,
                        value: event.target.value,
                      })
                    }
                  />
                )}
              </div>
            ))}
            <label
              className="demo-reviewed"
              htmlFor={thumbnail ? undefined : "demo-reviewed"}
            >
              {thumbnail ? (
                <span className="demo-checkbox-value">
                  {state.fields.reviewed ? "✓" : ""}
                </span>
              ) : (
                <input
                  id="demo-reviewed"
                  type="checkbox"
                  checked={state.fields.reviewed}
                  onChange={(event) =>
                    dispatch?.({
                      type: "field",
                      field: "reviewed",
                      value: event.target.checked,
                    })
                  }
                />
              )}
              {copy.reviewed}
            </label>
          </FormContainer>
          <div className="demo-paper-closing">
            <h5>Ready for whatever comes next.</h5>
            <p>Keep your notes close to the original.</p>
          </div>
        </>
      )}
      {state.page === 3 && (
        <>
          <p className="demo-paper-intro">
            A small checklist for a more thoughtful reading practice.
          </p>
          <ol className="demo-document-checklist">
            {[
              [
                "Find your focus.",
                "Start with one question. Give the document your attention.",
              ],
              [
                "Make it your own.",
                "Highlight useful passages and write down your questions.",
              ],
              [
                "Take the next step.",
                "Bring your notes into your next piece of work.",
              ],
            ].map(([title, text], index) => (
              <li key={title}>
                <span>0{index + 1}</span>
                <div>
                  <h4>{title}</h4>
                  <p>{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="demo-paper-bottom">
        <span>YOUR DOCUMENTS. YOUR SPACE.</span>
        <span>0{state.page} / 03</span>
      </div>
    </>
  );
}
