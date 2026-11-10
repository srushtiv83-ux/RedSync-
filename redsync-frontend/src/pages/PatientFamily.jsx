import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../lib/api'
import './PatientFamily.css'

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-']
const COMPONENTS = ['Whole Blood', 'Packed Red Cells', 'Platelets', 'Plasma']
const SEARCH_START_RADII = [5, 10, 15]
const MAX_SEARCH_RADIUS_KM = 20

export default function PatientFamily({ initialMode = 'request' }) {
  const [mode, setMode] = useState(initialMode)
  const [hospitals, setHospitals] = useState([])
  const [hospitalLoading, setHospitalLoading] = useState(true)
  const [search, setSearch] = useState({
    blood_group: 'O+',
    location: '',
    latitude: null,
    longitude: null,
    radius_km: 5,
  })
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchMessage, setSearchMessage] = useState('')
  const [locating, setLocating] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)
  const [form, setForm] = useState({
    requester_name: '', phone: '', blood_group: 'O+', units: 1,
    component: 'Whole Blood', urgency: 'urgent', hospital_name: '',
    city: '', notes: '', agree: false,
  })

  useEffect(() => {
    api.get('/public/hospitals')
      .then(({ data }) => setHospitals(data || []))
      .catch((err) => setError(errorMessage(err, 'Could not load approved hospitals.')))
      .finally(() => setHospitalLoading(false))
  }, [])

  const selectedHospital = useMemo(
    () => hospitals.find((h) => h.name === form.hospital_name),
    [hospitals, form.hospital_name],
  )

  const update = (event) => {
    const { name, value, type, checked } = event.target
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }))
  }

  async function useCurrentLocation() {
    setError('')
    setLocationMessage('')
    if (!navigator.geolocation) {
      setLocationMessage('Location is not supported by this browser. Enter your city and area manually.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      setSearch((current) => ({
        ...current,
        latitude: coords.latitude,
        longitude: coords.longitude,
      }))
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coords.latitude}&lon=${coords.longitude}`
        const response = await fetch(url, { headers: { 'Accept': 'application/json' } })
        if (!response.ok) throw new Error('Could not resolve this location.')
        const data = await response.json()
        const a = data.address || {}
        const city = a.city || a.town || a.village || a.suburb || a.county || ''
        const area = [a.suburb, a.neighbourhood, a.road].filter(Boolean).join(', ')
        setForm((current) => ({ ...current, city: city || current.city, notes: current.notes }))
        setSearch((current) => ({
          ...current,
          location: city || current.location,
          latitude: coords.latitude,
          longitude: coords.longitude,
        }))
        setLocationMessage(`Location detected${city ? `: ${[area, city].filter(Boolean).join(', ')}` : ''}. Verify the location before searching.`)
      } catch {
        setLocationMessage('Your location was detected for distance search, but its address could not be read.')
      } finally {
        setLocating(false)
      }
    }, (geoError) => {
      setLocating(false)
      setLocationMessage(geoError.code === 1
        ? 'Location permission was denied. You can enter the city and hospital manually.'
        : 'Could not detect your location. Please enter the city and hospital manually.')
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 })
  }

  async function findBlood(event) {
    event.preventDefault()
    setError('')
    setSearching(true)
    setResults([])
    setSearchMessage('')
    try {
      const hasCoordinates = search.latitude !== null && search.longitude !== null
      let responseData

      if (hasCoordinates) {
        for (let radius = search.radius_km; radius <= MAX_SEARCH_RADIUS_KM; radius += 5) {
          setSearchMessage(
            radius === search.radius_km
              ? `Searching within ${radius} km…`
              : `No matching stock within ${radius - 5} km. Expanding search to ${radius} km…`,
          )
          const { data } = await api.get('/public/find-blood', {
            params: {
              group: search.blood_group,
              latitude: search.latitude,
              longitude: search.longitude,
              radius_km: radius,
            },
          })
          responseData = data
          if (data.results?.length) {
            setSearchMessage(
              radius === search.radius_km
                ? `Blood stock found within ${radius} km.`
                : `No stock was found within ${search.radius_km} km. Search expanded to ${radius} km.`,
            )
            break
          }
          if (data.location_data_available === false) break
        }

        if (!responseData?.results?.length) {
          setSearchMessage(
            responseData?.location_data_available
              ? `No matching stock was found within ${MAX_SEARCH_RADIUS_KM} km.`
              : 'Nearby search needs map locations from approved hospitals. Try a city or PIN code search instead.',
          )
        }
      } else {
        const { data } = await api.get('/public/find-blood', {
          params: {
            group: search.blood_group,
            location: search.location.trim() || undefined,
          },
        })
        responseData = data
        setSearchMessage('For automatic radius expansion, use your current location.')
      }

      setResults(responseData?.results || [])
    } catch (err) {
      setError(errorMessage(err, 'Could not search blood availability.'))
      setSearchMessage('')
    } finally {
      setSearching(false)
    }
  }

  async function submitRequest(event) {
    event.preventDefault()
    setError('')
    setSuccess(null)
    if (!form.hospital_name.trim()) {
      setError('Enter the hospital where the patient is admitted. This helps the hospital team review the request.')
      return
    }
    try {
      const payload = {
        ...form,
        units: Number(form.units),
        city: form.city.trim(),
        hospital_name: form.hospital_name.trim(),
        notes: form.notes.trim() || null,
      }
      const { data } = await api.post('/public/request-blood', payload)
      setSuccess(data)
      setForm((current) => ({ ...current, requester_name: '', phone: '', notes: '', agree: false }))
    } catch (err) {
      setError(errorMessage(err, 'Your request could not be submitted. Please try again.'))
    }
  }

  return (
    <main className="pf-page">
      <header className="pf-nav">
        <Link to="/home" className="pf-brand"><span className="pf-brand-mark">+</span> RedSync</Link>
        <Link to="/home" className="pf-back">← Back to home</Link>
      </header>

      <section className="pf-hero">
        <div className="pf-hero-copy">
          <span className="pf-eyebrow">HELP WHEN EVERY SECOND MATTERS</span>
          <h1>Find blood.<br /><em>Bring hope closer.</em></h1>
          <p>Search blood availability at approved hospitals or send a request for the hospital team to review.</p>
          <div className="pf-hero-points"><span>✓ Verified hospital listings</span><span>✓ No family account required</span></div>
        </div>
        <div className="pf-hero-card"><div className="pf-drop">♥</div><strong>Need blood urgently?</strong><p>Submit the patient's blood requirement and the hospital team in your city can review it.</p><small>For a life-threatening emergency, call 112 or seek immediate medical care.</small></div>
      </section>

      <section className="pf-content">
        <div className="pf-tabs" role="tablist" aria-label="Patient services">
          <button className={mode === 'request' ? 'active' : ''} onClick={() => { setMode('request'); setError(''); }}>Request blood</button>
          <button className={mode === 'search' ? 'active' : ''} onClick={() => { setMode('search'); setError(''); }}>Find blood availability</button>
        </div>

        {error && <div className="pf-alert error" role="alert">{error}</div>}
        {success && <div className="pf-alert success" role="status"><strong>Request submitted successfully.</strong><p>{success.message}</p><span>Reference number: <b>#{success.id}</b></span><p className="pf-muted">Keep this reference number. This version confirms submission; live status tracking will need a separate backend endpoint.</p></div>}

        {mode === 'request' ? (
          <form className="pf-panel" onSubmit={submitRequest}>
            <div className="pf-panel-heading"><div><span className="pf-step">01 / BLOOD REQUEST</span><h2>Tell us what the patient needs</h2><p>Share the hospital and city where the patient is currently admitted.</p></div><span className="pf-heading-icon">✚</span></div>
            <div className="pf-grid">
              <label>Requester's full name<input name="requester_name" value={form.requester_name} onChange={update} placeholder="Your name" minLength="2" maxLength="120" required /></label>
              <label>Mobile number<input name="phone" type="tel" inputMode="numeric" value={form.phone} onChange={update} placeholder="10-digit mobile number" pattern="[6-9][0-9]{9}" maxLength="10" required /></label>
              <label>Blood group<select name="blood_group" value={form.blood_group} onChange={update}>{BLOOD_GROUPS.map((g) => <option key={g}>{g}</option>)}</select></label>
              <label>Blood component<select name="component" value={form.component} onChange={update}>{COMPONENTS.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label>Units required<input name="units" type="number" min="1" max="20" value={form.units} onChange={update} required /></label>
              <label>How urgent is it?<select name="urgency" value={form.urgency} onChange={update}><option value="critical">Critical</option><option value="urgent">Urgent</option><option value="normal">Normal</option></select></label>
            </div>

            <div className="pf-location-block">
              <div className="pf-location-title"><div><span className="pf-step">02 / LOCATION</span><h3>Where is the patient admitted?</h3><p>Use your current location as a starting point, then confirm the patient's hospital.</p></div><button type="button" className="pf-location-btn" onClick={useCurrentLocation} disabled={locating}>{locating ? 'Detecting…' : '◎ Use my current location'}</button></div>
              {locationMessage && <p className="pf-location-message">{locationMessage}</p>}
              <div className="pf-grid">
                <label>City<input name="city" value={form.city} onChange={update} placeholder="e.g. Bengaluru" minLength="2" maxLength="100" required /></label>
                <label>Hospital name<input name="hospital_name" list="pf-hospitals" value={form.hospital_name} onChange={update} placeholder={hospitalLoading ? 'Loading hospitals…' : 'Select or type hospital name'} minLength="2" maxLength="200" required /><datalist id="pf-hospitals">{hospitals.map((h) => <option key={h.id} value={h.name}>{h.city}</option>)}</datalist></label>
              </div>
              <div className="pf-radius-control">
                <span>Start search radius</span>
                <div className="pf-radius-options" role="group" aria-label="Starting search radius">
                  {SEARCH_START_RADII.map((radius) => (
                    <button
                      key={radius}
                      type="button"
                      className={search.radius_km === radius ? 'active' : ''}
                      aria-pressed={search.radius_km === radius}
                      onClick={() => setSearch((current) => ({ ...current, radius_km: radius }))}
                    >
                      {radius} km
                    </button>
                  ))}
                </div>
                <small>Automatically expands in 5 km steps, up to 20 km, when no stock is found.</small>
              </div>
              {selectedHospital && <div className="pf-hospital-hint">Selected: <b>{selectedHospital.name}</b> · {[selectedHospital.address, selectedHospital.city].filter(Boolean).join(', ')}{selectedHospital.phone ? ` · ${selectedHospital.phone}` : ''}</div>}
            </div>

            <label className="pf-full">Additional details <span className="pf-optional">(optional)</span><textarea name="notes" value={form.notes} onChange={update} rows="3" maxLength="300" placeholder="Any useful details for the hospital team (maximum 300 characters)" /></label>
            <label className="pf-consent"><input type="checkbox" name="agree" checked={form.agree} onChange={update} required /><span>I agree that RedSync may share this request and my contact number with relevant hospitals and donors for coordination.</span></label>
            <button className="pf-submit" type="submit">Submit blood request <span>→</span></button>
            <p className="pf-footnote">Your request is sent to the RedSync backend. Hospitals review public requests before forwarding them to donors.</p>
          </form>
        ) : (
          <form className="pf-panel" onSubmit={findBlood}>
            <div className="pf-panel-heading"><div><span className="pf-step">FIND AVAILABLE STOCK</span><h2>Search hospitals near the patient</h2><p>Search by city, hospital name or PIN code.</p></div><span className="pf-heading-icon">⌕</span></div>
                <div className="pf-search-grid">
              <label>Blood group<select value={search.blood_group} onChange={(e) => setSearch({ ...search, blood_group: e.target.value })}>{BLOOD_GROUPS.map((g) => <option key={g}>{g}</option>)}</select></label>
                  <label>City / hospital / PIN code<input value={search.location} onChange={(e) => setSearch({ ...search, location: e.target.value, latitude: null, longitude: null })} placeholder="e.g. Bengaluru or 560001" /></label>
                  <button type="button" className="pf-location-btn" onClick={useCurrentLocation} disabled={locating}>{locating ? 'Detecting…' : '◎ Use my location'}</button>
            </div>
                <div className="pf-radius-control">
                  <span>Start search radius</span>
                  <div className="pf-radius-options" role="group" aria-label="Starting search radius">
                    {SEARCH_START_RADII.map((radius) => (
                      <button
                        key={radius}
                        type="button"
                        className={search.radius_km === radius ? 'active' : ''}
                        aria-pressed={search.radius_km === radius}
                        onClick={() => setSearch((current) => ({ ...current, radius_km: radius }))}
                      >
                        {radius} km
                      </button>
                    ))}
                  </div>
                  <small>Automatically expands in 5 km steps, up to 20 km, when no stock is found.</small>
                </div>
                {locationMessage && <p className="pf-location-message" role="status">{locationMessage}</p>}
                <button className="pf-submit pf-search-button" type="submit" disabled={searching}>{searching ? 'Searching…' : 'Search availability →'}</button>
                {searchMessage && <p className="pf-search-message" role="status">{searchMessage}</p>}
                {results.length > 0 ? <div className="pf-results">{results.map((hospital) => { const stock = hospital.stock?.[0]; return <article className="pf-result-card" key={hospital.id}><div><h3>{hospital.name}</h3><p>{[hospital.address, hospital.city].filter(Boolean).join(', ')}</p><small>{hospital.open_24h ? 'Open 24 hours' : hospital.facility_type}{Number.isFinite(hospital.distance_km) ? ` · ${hospital.distance_km} km away` : ''}</small></div><div className="pf-stock"><b>{stock?.units ?? 0}</b><span>{search.blood_group} units</span><small>{stock?.status || 'Unknown'}</small></div><div className="pf-contact">{hospital.phone && <a href={`tel:${hospital.phone}`}>Call hospital</a>}{hospital.emergency_phone && <a href={`tel:${hospital.emergency_phone}`}>Emergency line</a>}</div></article> })}</div> : <div className="pf-empty">{searching ? searchMessage : searchMessage || 'Search to see available stock at approved hospitals.'}</div>}
            <p className="pf-footnote">Availability can change quickly. Call the hospital to confirm stock and suitability before travelling.</p>
          </form>
        )}
      </section>
      <footer className="pf-footer">RedSync · Connecting donors, hospitals and families</footer>
    </main>
  )
}
