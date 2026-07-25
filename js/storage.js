/**
 * TripStore - localStorage-backed persistence for trips.
 * Everything lives on the device; nothing is sent to a server.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TripStore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY = 'travel-planner:trips:v1';

  function uid() {
    return 't' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function load() {
    try {
      const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(KEY) : null;
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function save(trips) {
    localStorage.setItem(KEY, JSON.stringify(trips));
  }

  function newTrip(fields) {
    const trip = Object.assign({
      id: uid(),
      createdAt: new Date().toISOString(),
      name: '',
      type: 'private',            // 'business' | 'private'
      destinationCity: '',
      destinationCountry: '',
      destAirportCode: '',
      originAirport: 'TLV',
      startDate: '',
      endDate: '',
      travelers: 1,
      cabin: 'business',
      directOnly: true,
      preferredAirline: 'LY',    // El Al by default; '' = no preference
      hotelStars: 5,
      venueName: '',
      venueAddress: '',
      budgetAmount: 0,
      budgetCurrency: 'USD',
      expenses: [],
      itinerary: {},              // { 'YYYY-MM-DD': [ {id,time,title,notes,category} ] }
      documents: [],              // { id, name, note, dataUrl?, mime? }
      checklist: [],              // { id, text, done }
      reminders: [],              // { id, datetime, text, done }
      bookedFlight: { outboundNo: '', outboundDep: '', returnNo: '', returnDep: '', notes: '' },
      bookedHotel: { name: '', address: '', confirmation: '', notes: '' }
    }, fields || {});
    return trip;
  }

  function all() {
    return load().sort(function (a, b) {
      return (a.startDate || '9999').localeCompare(b.startDate || '9999');
    });
  }

  function get(id) {
    return load().find(function (t) { return t.id === id; }) || null;
  }

  function upsert(trip) {
    const trips = load();
    const i = trips.findIndex(function (t) { return t.id === trip.id; });
    if (i >= 0) trips[i] = trip; else trips.push(trip);
    save(trips);
    return trip;
  }

  function remove(id) {
    save(load().filter(function (t) { return t.id !== id; }));
  }

  return { newTrip: newTrip, all: all, get: get, upsert: upsert, remove: remove, uid: uid, _KEY: KEY };
});
