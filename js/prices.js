/**
 * TravelApi - in-app flight & hotel prices via the Travelpayouts data APIs
 * (Aviasales cached flight prices + Hotellook cached hotel prices).
 *
 * The user's API token is stored ONLY in localStorage on their device
 * (entered once in the settings screen) - never in this repository.
 *
 * Prices are cached from recent real searches, so they are representative;
 * the final price is confirmed on the booking page the result links to.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TravelApi = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FLIGHTS_URL = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';
  var HOTELS_URL = 'https://engine.hotellook.com/api/v2/cache.json';
  var BOOK_BASE = 'https://www.aviasales.com';

  var TRIP_CLASS = { economy: '0', premium_economy: '0', business: '1', first: '2' };

  var AIRLINES = {
    LY: 'אל על', '6H': 'ישראייר', IZ: 'ארקיע',
    AF: 'Air France', LH: 'Lufthansa', BA: 'British Airways', TK: 'Turkish Airlines',
    LX: 'SWISS', OS: 'Austrian', SN: 'Brussels Airlines', A3: 'Aegean',
    AZ: 'ITA Airways', KL: 'KLM', IB: 'Iberia', EK: 'Emirates', QR: 'Qatar Airways',
    ET: 'Ethiopian', W6: 'Wizz Air', U2: 'easyJet', FR: 'Ryanair', DL: 'Delta',
    UA: 'United', AA: 'American', VS: 'Virgin Atlantic', AY: 'Finnair', LO: 'LOT'
  };

  function airlineName(code) {
    return AIRLINES[String(code || '').toUpperCase()] || String(code || '');
  }

  /** Query params for the Aviasales prices_for_dates endpoint. */
  function buildFlightParams(trip) {
    return {
      origin: String(trip.originAirport || 'TLV').toUpperCase(),
      destination: String(trip.destAirportCode || '').toUpperCase(),
      departure_at: trip.startDate,
      return_at: trip.endDate,
      currency: 'usd',
      trip_class: TRIP_CLASS[trip.cabin] || '0',
      direct: trip.directOnly ? 'true' : 'false',
      one_way: 'false',
      sorting: 'price',
      unique: 'false',
      limit: '30',
      page: '1'
    };
  }

  /** Normalize a prices_for_dates response into rows sorted by price (asc). */
  function parseFlights(json) {
    if (!json || !Array.isArray(json.data)) return [];
    var currency = String(json.currency || 'usd').toUpperCase();
    return json.data.map(function (f) {
      var code = String(f.airline || '').toUpperCase();
      return {
        price: parseFloat(f.price) || 0,
        currency: currency,
        airlineCode: code,
        airlineName: airlineName(code),
        isElal: code === 'LY',
        outbound: {
          dep: f.departure_at || '',
          from: f.origin_airport || f.origin || '',
          to: f.destination_airport || f.destination || '',
          stops: f.transfers != null ? f.transfers : null
        },
        inbound: f.return_at ? {
          dep: f.return_at,
          from: f.destination_airport || f.destination || '',
          to: f.origin_airport || f.origin || '',
          stops: f.return_transfers != null ? f.return_transfers : null
        } : null,
        bookUrl: f.link ? BOOK_BASE + f.link : null
      };
    }).sort(function (a, b) { return a.price - b.price; });
  }

  /** Query params for the Hotellook cache endpoint. */
  function buildHotelParams(trip) {
    return {
      location: (trip.destinationCity || '').trim(),
      checkIn: trip.startDate,
      checkOut: trip.endDate,
      currency: 'usd',
      limit: '50'
    };
  }

  /** Normalize a Hotellook cache response: keep >= minStars, sort by price. */
  function parseHotels(json, minStars) {
    var list = Array.isArray(json) ? json : (json && Array.isArray(json.data) ? json.data : []);
    var min = minStars != null ? minStars : 5;
    return list
      .filter(function (h) { return (h.stars || 0) >= min; })
      .map(function (h) {
        return {
          name: h.hotelName || h.name || '',
          stars: h.stars || 0,
          price: parseFloat(h.priceAvg || h.priceFrom) || 0,
          currency: 'USD'
        };
      })
      .filter(function (h) { return h.price > 0; })
      .sort(function (a, b) { return a.price - b.price; });
  }

  function qs(params) {
    return Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
  }

  /* ---------- runtime (browser) ---------- */

  function apiGet(url, params, token) {
    return fetch(url + '?' + qs(params) + '&token=' + encodeURIComponent(token || ''))
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error('BAD_TOKEN');
        if (r.status === 429) throw new Error('RATE_LIMIT');
        if (!r.ok) throw new Error('HTTP_' + r.status);
        return r.json();
      })
      .then(function (j) {
        if (j && j.success === false) {
          throw new Error(/token/i.test(j.error || '') ? 'BAD_TOKEN' : (j.error || 'API_ERROR'));
        }
        return j;
      });
  }

  function searchFlights(trip, creds) {
    return apiGet(FLIGHTS_URL, buildFlightParams(trip), creds && creds.apiToken)
      .then(parseFlights);
  }

  function searchHotels(trip, creds) {
    return apiGet(HOTELS_URL, buildHotelParams(trip), creds && creds.apiToken)
      .then(function (json) { return parseHotels(json, trip.hotelStars || 5); });
  }

  return {
    buildFlightParams: buildFlightParams,
    parseFlights: parseFlights,
    buildHotelParams: buildHotelParams,
    parseHotels: parseHotels,
    airlineName: airlineName,
    searchFlights: searchFlights,
    searchHotels: searchHotels,
    _qs: qs
  };
});
