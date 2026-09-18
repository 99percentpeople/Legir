import { BookOpen, Check, Highlighter, ListTodo, Sparkles } from "lucide-react";
import type { LandingCopy } from "../content/types";

const ICONS = [BookOpen, Highlighter, ListTodo, Sparkles];

export function FeatureSection({ copy }: { copy: LandingCopy["features"] }) {
  return (
    <section
      className="features-section site-container section-space"
      id="features"
      aria-labelledby="features-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h2 id="features-title">{copy.title}</h2>
        </div>
        <p>{copy.description}</p>
      </div>
      <div className="feature-grid">
        {copy.items.map((feature, index) => {
          const Icon = ICONS[index];
          return (
            <article
              className={`feature-tile feature-${index}`}
              key={feature.title}
            >
              <div className="feature-copy">
                <span className="feature-icon">
                  <Icon size={21} aria-hidden="true" />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
                <span className="feature-tag">{copy.tags[index]}</span>
              </div>
              <div className="feature-art" aria-hidden="true">
                {index === 0 && (
                  <div className="mini-book">
                    <div className="mini-page">
                      <span>01</span>
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                    <div className="mini-page">
                      <BookOpen size={27} />
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                  </div>
                )}
                {index === 1 && (
                  <div className="mini-highlight">
                    <span>Aa</span>
                    <div className="highlight-palette">
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                    <div className="mini-pencil">
                      <Highlighter size={20} />
                    </div>
                  </div>
                )}
                {index === 2 && (
                  <div className="mini-form">
                    <div>
                      <span>Aa</span>
                      <i />
                    </div>
                    <div>
                      <span>
                        <Check size={15} />
                      </span>
                      <i />
                    </div>
                    <div>
                      <span>
                        <Check size={15} />
                      </span>
                      <i />
                    </div>
                  </div>
                )}
                {index === 3 && (
                  <div className="mini-ai">
                    <div className="ai-ring" />
                    <div className="ai-ring" />
                    <span>
                      <Sparkles size={30} strokeWidth={1.3} />
                    </span>
                    <i />
                    <i />
                    <i />
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
