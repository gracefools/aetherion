// G2: the talent picker in the skill book. Three tiers (levels 20, 40, 60), one choice in each;
// free, and changeable outside combat.
import React from 'react';
import { talentBlock, talentIn, TALENT_TIERS } from '../../shared/src/talents';
import type { Game, Hud } from './game/Game';
import { t, tm, useT } from './i18n';

export function TalentPicker({ hud, game }: { hud: Hud; game: Game }) {
  useT();
  const me = hud.self!, b = hud.build!;
  return (
    <div className="talents">
      <p className="sub">{t('talent.help')}</p>
      {TALENT_TIERS.map((tier, i) => {
        const chosen = talentIn(b.skills, i + 1), locked = me.level < tier.level;
        return (
          <section key={tier.name} className={'talenttier' + (locked ? ' locked' : '')} aria-label={tier.name}>
            <h3>{tier.name} <small>{t('common.level', { n: tier.level })}</small></h3>
            <div className="talentrow">
              {tier.options.map((o, c) => {
                const on = chosen?.id === o.id, why = talentBlock(me.level, b.skills, `talent.${i + 1}.${c + 1}`);
                return (
                  <button key={o.id} className={'talentcard' + (on ? ' on' : '')} disabled={!!why && !on} aria-pressed={on}
                    title={why && !on ? tm(why) : undefined} onClick={() => !on && game.learn(`talent.${i + 1}.${c + 1}`)}>
                    <b>{o.name}</b>
                    <span>{o.desc}</span>
                    <em>{on ? t('talent.chosen') : locked ? t('common.level', { n: tier.level }) : t('talent.choose')}</em>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
