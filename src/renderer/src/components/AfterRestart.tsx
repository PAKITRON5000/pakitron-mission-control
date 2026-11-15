// EV189 (the user, 15-11 03:58: «anoche se reinició el pc… y se me quedó en la pantalla de bloqueo… todo se cerró, no hay
// manera de que… esta app se abra para mandar a trabajar a los claude?… estaría bien integrar la opción para activarla
// dentro de la app»): what makes the Claudes go back to work alone after a restart, in Ajustes. The app opens when the
// user signs in (its own switch); signing in by itself is Windows' (or the Mac's) and stays the user's choice.
import { t } from '../../../core/i18n'
import { useStore, useAsync } from '../lib/store'
import { api } from '../lib/api'
import { SectionTitle, Segmented } from './ui'

export function AfterRestart() {
  const { toast } = useStore()
  const info = useAsync(() => api<{ on: boolean; packaged: boolean; platform: string }>('loginItem'), [])
  const mac = info.data?.platform === 'darwin'
  const phone = window.pmc?.platform === 'remote'
  const set = (on: boolean) => api<boolean>('setLoginItem', on).then(() => { info.reload(); toast(on ? t('Se abrirá sola al iniciar sesión') : t('Ya no se abrirá sola al iniciar sesión')) }, (e: Error) => toast(e.message))
  const open = (what: string, said: string) => api(what).then(() => toast(said), (e: Error) => toast(e.message))
  return (
    <section className="mb-8">
      <SectionTitle title={t('Después de un reinicio')} sub={t('Que los Claude vuelvan a trabajar solos si el PC se reinicia')} />
      <div className="group p-5 flex flex-col gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="w-44 c2">{mac ? t('Abrir al iniciar sesión en el Mac') : t('Abrir al entrar en Windows')}</span>
          <Segmented value={info.data?.on ? 'si' : 'no'} onChange={(v) => void set(v === 'si')} options={[{ value: 'si', label: t('Sí') }, { value: 'no', label: t('No') }]} />
          {info.data && !info.data.packaged && <span className="t-small c3">{t('(solo en la app instalada)')}</span>}
        </div>
        <div className="t-small c2 leading-relaxed">{t('Con esto, al iniciar sesión se abre Mission Control, y en unos minutos la rueda y la cuenta de reserva vuelven a poner a trabajar a quien le toque.')}</div>
        <div className="t-small c2 leading-relaxed">{t('Pero tras un reinicio, hasta que alguien inicia sesión no puede abrirse nada: ni la app ni los Claude. Para que la sesión se inicie sola:')}</div>
        {mac ? (
          <div className="rounded-2xl px-4 py-3 flex items-center gap-3 flex-wrap" style={{ background: 'var(--fill)' }}>
            <div className="t-small c2 flex-1 min-w-[220px]">{t('En el Mac: Ajustes del Sistema › Usuarios y grupos › Iniciar sesión automáticamente. No se puede con FileVault activado, y cualquiera que encienda el Mac entra en tu sesión: decídelo tú.')}</div>
            <button className="btn btn-sm" onClick={() => void open('openSignInOptions', t('Abierto en el Mac'))}>{t('Abrir Usuarios y grupos')}</button>
          </div>
        ) : (
          <>
            <div className="rounded-2xl px-4 py-3 flex items-center gap-3 flex-wrap" style={{ background: 'var(--fill)' }}>
              <div className="t-small c2 flex-1 min-w-[220px]"><b>{t('Tras una actualización de Windows')}</b>{t(' (lo más común de noche): la opción «Usar mi información de inicio de sesión para terminar de configurar automáticamente después de una actualización». Windows inicia tu sesión y la bloquea, así que la app se abre aunque veas la pantalla de bloqueo.')}</div>
              <button className="btn btn-sm" onClick={() => void open('openSignInOptions', phone ? t('Abierta en el PC') : t('Abierta: búscala al final de la página'))}>{phone ? t('Abrir esa opción en el PC') : t('Abrir esa opción de Windows')}</button>
            </div>
            <div className="rounded-2xl px-4 py-3 flex items-center gap-3 flex-wrap" style={{ background: 'var(--fill)' }}>
              <div className="t-small c2 flex-1 min-w-[220px]"><b>{t('Tras cualquier reinicio')}</b>{t(' (un corte de luz, un cuelgue): el inicio de sesión automático. Guarda tu contraseña en el PC y cualquiera que lo encienda entra en tu sesión, así que lo decides tú: la app no lo activa. Se hace con Autologon, de Microsoft.')}</div>
              <button className="btn btn-sm" onClick={() => void api('openExternal', 'https://learn.microsoft.com/sysinternals/downloads/autologon')}>{t('Ver Autologon')}</button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
