// The codex in the journal: monsters (region sets with a bonus), pets and mounts. Every entry
// opens its details. Pets and mounts not yet owned show as silhouettes with where to find them.
import React, { useState } from 'react';
import { MOUNTS, PET_FLAT_TOP, PET_GRADE_COLOR, PET_GRADES, PET_MAX_LEVEL, PET_SKILLS, PET_TIER_COLOR, PET_TIER_MULS, PET_TIERS, petBonus, PETS, petSkillPower } from '../../shared/src/companions';
import { PET_DROP_ELITE, GROUND_MOUNT_DROP, WORLD_BOSS_PET_DROP } from '../../shared/src/items';
import { CODEX_BONUS, CODEX_SETS, codexCard, codexComplete, codexNeed, codexRegionOf } from '../../shared/src/journal';
import { MONSTERS } from '../../shared/src/monsters';
import { REGIONS, ZONES } from '../../shared/src/world';
import { mountSprite, MOUNT_H, MOUNT_W, PET_W, petSprite } from './game/companions';
import { HD_MOUNT_H, HD_MOUNT_W, HD_PET, hdMountSprite, hdPetSprite } from './game/hdcomp';
import type { Hud } from './game/Game';
import { t, type Key } from './i18n';
import { bonusText } from './journalUi';
import { Portrait } from './pvp';
import { settings } from './settings';

type Sec = 'monsters' | 'pets' | 'mounts';
type Sel = { k: 'mon' | 'pet' | 'mount'; id: string } | null;
const SECS: Sec[] = ['monsters', 'pets', 'mounts'];
const hd = () => settings.get().graphics.art === 'hd';
const PetArt = ({ id, scale = 2 }: { id: string; scale?: number }) => (hd() ? <Portrait sheet={hdPetSprite(id)} w={HD_PET} h={HD_PET} scale={scale} /> : <Portrait sheet={petSprite(id)} w={PET_W} h={PET_W} scale={scale + 1} />);
const MountArt = ({ id }: { id: string }) => (hd() ? <Portrait sheet={hdMountSprite(id)} w={HD_MOUNT_W} h={HD_MOUNT_H} scale={1} /> : <Portrait sheet={mountSprite(id)} w={MOUNT_W} h={MOUNT_H} scale={2} />);

export function CodexTab({ hud }: { hud: Hud }) {
  const [sec, setSec] = useState('monsters' as Sec) as [Sec, (s: Sec) => void];
  const [sel, setSel] = useState(null as Sel) as [Sel, (s: Sel) => void];
  const j = hud.journal, c = hud.comp;
  const ownedPets = new Set(c.pets.map((p) => p.kind));
  const counts: Record<Sec, string> = {
    monsters: `${Object.keys(MONSTERS).filter((id) => codexRegionOf(id) && codexCard(j.k, id)).length} / ${REGIONS.reduce((n, z) => n + CODEX_SETS[z].length, 0)}`,
    pets: `${ownedPets.size} / ${Object.keys(PETS).length}`,
    mounts: `${c.mounts.length} / ${Object.keys(MOUNTS).length}`,
  };
  const pick = (s: Sel) => setSel(sel && s && sel.k === s.k && sel.id === s.id ? null : s);
  const isSel = (k: string, id: string) => !!sel && sel.k === k && sel.id === id;
  return (
    <div className="jrbody codex">
      <div className="tabs codextabs" role="tablist" aria-label={t('codex.sections')}>
        {SECS.map((x) => <button key={x} role="tab" aria-selected={sec === x} className={sec === x ? 'on' : ''} onClick={() => { setSec(x); setSel(null); }}>{t(`codex.sec.${x}` as Key)} <small className="sub">{counts[x]}</small></button>)}
      </div>
      <div className="codexwrap">
        <div className="codexlist">
          {sec === 'monsters' && <>
            <p className="sub">{t('jr.codexHelp')} {t('codex.clickHelp')}</p>
            {REGIONS.map((z) => {
              const done = codexComplete(j.k, z), set = CODEX_SETS[z];
              return (
                <section key={z} className={'codexset' + (done ? ' on' : '')} aria-label={ZONES[z].name}>
                  <h3>{ZONES[z].name} <small className="sub">{set.filter((id) => codexCard(j.k, id)).length} / {set.length} · {done ? t('jr.setDone') : t('jr.setBonus')}: {bonusText(CODEX_BONUS[z])}</small></h3>
                  <div className="cards">
                    {set.map((id) => {
                      const have = codexCard(j.k, id), n = Math.min(codexNeed(id), j.k[id] ?? 0);
                      return (
                        <button key={id} className={'card' + (have ? ' on' : '') + (isSel('mon', id) ? ' sel' : '')} aria-pressed={isSel('mon', id)} onClick={() => pick({ k: 'mon', id })} title={`${have || n ? MONSTERS[id].name : '???'}: ${n} / ${codexNeed(id)}`}>
                          <b>{have || n ? MONSTERS[id].name : '???'}</b>
                          <small>{t('common.lv', { n: MONSTERS[id].level })}{MONSTERS[id].boss ? ' · ★' : MONSTERS[id].elite ? ' · ◆' : ''}</small>
                          <small>{n} / {codexNeed(id)}</small>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </>}
          {sec === 'pets' && <>
            <p className="sub">{t('codex.petsHelp')}</p>
            <div className="cards compcards">
              {Object.values(PETS).map((d) => {
                const own = ownedPets.has(d.id);
                return (
                  <button key={d.id} className={'card compcard' + (own ? ' on' : ' unowned') + (isSel('pet', d.id) ? ' sel' : '')} aria-pressed={isSel('pet', d.id)} onClick={() => pick({ k: 'pet', id: d.id })}>
                    <span className="cart"><PetArt id={d.id} /></span>
                    <b>{d.name}</b>
                    <small>{t(`comp.stat.${d.stat}` as Key)}</small>
                    <small>{own ? t('codex.owned', { n: c.pets.filter((p) => p.kind === d.id).length }) : t('codex.notOwned')}</small>
                  </button>
                );
              })}
            </div>
          </>}
          {sec === 'mounts' && <>
            <p className="sub">{t('codex.mountsHelp')}</p>
            <div className="cards compcards">
              {Object.values(MOUNTS).map((d) => {
                const own = c.mounts.includes(d.id);
                return (
                  <button key={d.id} className={'card compcard' + (own ? ' on' : ' unowned') + (isSel('mount', d.id) ? ' sel' : '')} aria-pressed={isSel('mount', d.id)} onClick={() => pick({ k: 'mount', id: d.id })}>
                    <span className="cart wide"><MountArt id={d.id} /></span>
                    <b>{d.name}</b>
                    <small>+{Math.round((d.speed - 1) * 100)}% · {t('common.lv', { n: d.level })}{d.fly ? ' · ' + t('comp.flies') : ''}</small>
                    <small>{own ? t('codex.ownedOne') : t('codex.notOwned')}</small>
                  </button>
                );
              })}
            </div>
          </>}
        </div>
        {sel && (
          <aside className="codexdetail" aria-label={t('codex.details')}>
            <button className="small link panelx" onClick={() => setSel(null)} aria-label={t('codex.closeDetails')}>{t('common.close')}</button>
            {sel.k === 'mon' && <MonsterDetail id={sel.id} kills={j.k[sel.id] ?? 0} />}
            {sel.k === 'pet' && <PetDetail id={sel.id} hud={hud} />}
            {sel.k === 'mount' && <MountDetail id={sel.id} own={c.mounts.includes(sel.id)} level={hud.self?.level ?? 1} />}
          </aside>
        )}
      </div>
    </div>
  );
}

function MonsterDetail({ id, kills }: { id: string; kills: number }) {
  const m = MONSTERS[id], need = codexNeed(id), seen = kills > 0, z = codexRegionOf(id);
  const kind = m.boss ? t('codex.kind.boss') : m.elite ? t('codex.kind.elite') : t('codex.kind.normal');
  return (
    <div className="cdetail">
      <h3>{seen ? m.name : '???'}</h3>
      <div className="chips"><span className="chip">{t('common.lv', { n: m.level })}</span><span className="chip">{kind}</span>{z && <span className="chip">{ZONES[z].name}</span>}{m.flying && <span className="chip">{t('codex.flying')}</span>}</div>
      <div className="meterbar exp" role="meter" aria-valuenow={Math.min(kills, need)} aria-valuemin={0} aria-valuemax={need} aria-label={t('codex.progress')}>
        <i style={{ width: `${Math.min(100, (kills / need) * 100)}%` }} /><small>{t('codex.kills', { a: Math.min(kills, need), b: need })}</small>
      </div>
      {seen ? (
        <dl className="cstats">
          <dt>{t('stat.hp')}</dt><dd>{m.hp.toLocaleString()}</dd>
          <dt>{t('stat.atk')}</dt><dd>{m.atk}</dd>
          <dt>{t('stat.def')}</dt><dd>{m.def}</dd>
          <dt>{t('stat.mdef')}</dt><dd>{m.mdef}</dd>
          <dt>{t('codex.exp')}</dt><dd>{m.exp.toLocaleString()}</dd>
          <dt>{t('codex.temper')}</dt><dd>{m.flee ? t('codex.flees') : m.aggro > 0 ? t('codex.aggressive') : t('codex.neutral')}</dd>
        </dl>
      ) : <p className="sub">{t('codex.unseen')}</p>}
      {z && <p className="sub">{t('codex.setNote', { region: ZONES[z].name, bonus: bonusText(CODEX_BONUS[z]) })}</p>}
    </div>
  );
}

function PetDetail({ id, hud }: { id: string; hud: Hud }) {
  const d = PETS[id], sk = PET_SKILLS[id], mine = hud.comp.pets.filter((p) => p.kind === id), stat = t(`comp.stat.${d.stat}` as Key);
  const flat = (v: number) => (d.stat === 'crit' || d.stat === 'dodge' ? v.toFixed(1) : v.toLocaleString());
  return (
    <div className="cdetail">
      <div className="chero"><span className={'cart' + (mine.length ? '' : ' unowned')}><PetArt id={id} scale={3} /></span><div><h3>{d.name}</h3><div className="chips"><span className="chip">{stat}</span><span className="chip">{mine.length ? t('codex.owned', { n: mine.length }) : t('codex.notOwned')}</span></div></div></div>
      {sk && <div className="petskill"><b>✦ {t(`pet.skill.${id}` as Key)}</b> <small className="sub">{Math.round(sk.cdMs / 1000)}s</small><div className="sub">{t(`pet.desc.${id}` as Key, { n: Math.round(sk.mul * petSkillPower(1) * 100) })}</div></div>}
      <h4>{t('codex.byTier')}</h4>
      <div className="tablewrap"><table className="ctable">
        <thead><tr><th>{t('codex.tier')}</th><th>{t('codex.pctAt', { n: PET_MAX_LEVEL })}</th><th>{t('codex.flatAt', { n: PET_MAX_LEVEL })}</th><th>{t('codex.skill')}</th></tr></thead>
        <tbody>{PET_TIERS.map((_, i) => (
          <tr key={i}>
            <td style={{ color: PET_TIER_COLOR[i] }}>{t(`comp.tier.${i}` as Key)}</td>
            <td>+{petBonus(d, PET_MAX_LEVEL, i)}{d.pct ? '%' : ''}</td>
            <td>+{flat(PET_FLAT_TOP[d.stat][i] * 0.3)} – {flat(PET_FLAT_TOP[d.stat][i])}</td>
            <td>×{PET_TIER_MULS[i]}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="sub">{t('codex.flatHelp', { stat })}</p>
      <h4>{t('codex.grades')}</h4>
      <div className="chips">{PET_GRADES.map((g) => <span key={g.g} className="chip" style={{ color: PET_GRADE_COLOR[g.g] }}>{g.g} {g.lo}–{g.hi}% · {g.w}%</span>)}</div>
      <h4>{t('codex.source')}</h4>
      <p className="sub">{t('codex.petSource', { n: Math.round(PET_DROP_ELITE * 100) })}{id === 'moss_sprout' ? ' ' + t('codex.petShop') : ''}</p>
      <p className="sub">{t('codex.petBoss')}</p>
      <div className="tablewrap"><table className="ctable bossodds">
        <thead><tr><th>{t('codex.bossLv')}</th>{PET_TIERS.map((_, i) => <th key={i} style={{ color: PET_TIER_COLOR[i] }}>{t(`comp.tier.${i}` as Key)}</th>)}</tr></thead>
        <tbody>{WORLD_BOSS_PET_DROP.map((b, i) => (
          <tr key={b.upTo}><td>{(i ? WORLD_BOSS_PET_DROP[i - 1].upTo + 1 : 1)}–{b.upTo}</td>{b.pct.map((v, k) => <td key={k}>{v}%</td>)}</tr>
        ))}</tbody>
      </table></div>
      {mine.length > 0 && <>
        <h4>{t('codex.yours')}</h4>
        <ul className="cmine">{mine.map((p) => <li key={p.uid}><b>{p.name}</b> <small className="sub">{t('common.lv', { n: p.level })}</small> <span style={{ color: PET_TIER_COLOR[p.tier] }}>{t(`comp.tier.${p.tier}` as Key)}</span> · <span style={{ color: PET_GRADE_COLOR[PET_GRADES.find((g) => p.gr >= g.lo && p.gr <= g.hi)?.g ?? 'D'] }}>{t('comp.grade', { g: PET_GRADES.find((g) => p.gr >= g.lo && p.gr <= g.hi)?.g ?? 'D', n: p.gr })}</span></li>)}</ul>
      </>}
    </div>
  );
}

function MountDetail({ id, own, level }: { id: string; own: boolean; level: number }) {
  const d = MOUNTS[id];
  const source = id === 'sky_griffin' ? t('codex.src.griffin') : id === 'star_drake' ? t('codex.src.drake') : t('codex.src.ground', { n: Math.round(GROUND_MOUNT_DROP * 100) }) + (id === 'plains_strider' ? ' ' + t('codex.src.shop') : '');
  return (
    <div className="cdetail">
      <div className="chero"><span className={'cart wide' + (own ? '' : ' unowned')}><MountArt id={id} /></span><div><h3>{d.name}</h3><div className="chips"><span className="chip">{own ? t('codex.ownedOne') : t('codex.notOwned')}</span></div></div></div>
      <dl className="cstats">
        <dt>{t('codex.speed')}</dt><dd>+{Math.round((d.speed - 1) * 100)}%</dd>
        <dt>{t('codex.needLv')}</dt><dd className={level < d.level ? 'lowq' : 'okq'}>{d.level}</dd>
        <dt>{t('codex.travel')}</dt><dd>{d.fly ? t('codex.fliesHelp') : t('codex.ground')}</dd>
      </dl>
      <h4>{t('codex.source')}</h4>
      <p className="sub">{source}</p>
    </div>
  );
}
