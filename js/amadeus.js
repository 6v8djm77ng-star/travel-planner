/**
 * TravelApi - in-app live flight & hotel search via the Amadeus Self-Service API.
 *
 * The user's API key/secret are stored ONLY in localStorage on their device
 * (entered once in the settings screen) - never in this repository.
 *
 * Pure builder/parser functions are exported for unit testing; the fetch-based
 * functions are used by the app at runtime.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TravelApi = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BASE = 'https://test.api.amadeus.com';

  var CABIN = {
    economy: 'ECONOMY',
    premium_economy: 'PREMIUM_ECONOMY',
    business: 'BUSINESS',
    first: 'FIRST'
  };

  // airport -> IATA city code (needed for hotel search); same-code cities omitted
  var CITY_OF = {
    CDG: 'PAR', ORY: 'PAR', LHR: 'LON', LGW: 'LON', STN: 'LON', LTN: 'LON',
    JFK: 'NYC', EWR: 'NYC', LGA: 'NYC', HND: 'TYO', NRT: 'TYO',
    MXP: 'MIL', LIN: 'MIL', BGY: 'MIL', FCO: 'ROM', CIA: 'ROM',
    SVO: 'MOW', DME: 'MOW', ARN: 'STO', GRU: 'SAO', GIG: 'RIO',
    ICN: 'SEL', GMP: 'SEL', PEK: 'BJS', PKX: 'BJS', PVG: 'SHA', SHA: 'SHA',
    YYZ: 'YTO', YUL: 'YMQ', IAD: 'WAS', DCA: 'WAS', ORD: 'CHI', MDW: 'CHI',
    SAW: 'IST', OTP: 'BUH', BSL: 'EAP'
  };

  function cityCode(airportCode) {
    var a = String(airportCode || '').toUpperCase();
    return CITY_OF[a] || a;
  }

  /** Query params for GET /v2/shopping/flight-offers */
  function buildFlightParams(trip) {
    var p = {
      originLocationCode: String(trip.originAirport || 'TLV').toUpperCase(),
      destinationLocationCode: String(trip.destAirportCode || '').toUpperCase(),
      departureDate: trip.startDate,
      returnDate: trip.endDate,
      adults: String(Math.max(1, parseInt(trip.travelers, 10) || 1)),
      travelClass: CABIN[trip.cabin] || 'ECONOMY',
      currencyCode: 'USD',
      max: '30'
    };
    if (trip.directOnly) p.nonStop = 'true';
    return p;
  }

  function seg(itin, dict) {
    if (!itin || !itin.segments || !itin.segments.length) return null;
    var first = itin.segments[0];
    var last = itin.segments[itin.segments.length - 1];
    var codes = [];
    itin.segments.forEach(function (s) {
      if (codes.indexOf(s.carrierCode) === -1) codes.push(s.carrierCode);
    });
    return {
      dep: first.departure.at,
      arr: last.arrival.at,
      from: first.departure.iataCode,
      to: last.arrival.iataCode,
      stops: itin.segments.length - 1,
      carriers: codes.map(function (c) { return (dict && dict[c]) || c; }),
      carrierCodes: codes
    };
  }

  /** Normalize a flight-offers response into rows sorted by price (asc). */
  function parseFlightOffers(json) {
    if (!json || !Array.isArray(json.data)) return [];
    var carriers = (json.dictionaries && json.dictionaries.carriers) || {};
    return json.data.map(function (o) {
      var out = seg(o.itineraries && o.itineraries[0], carriers);
      var ret = seg(o.itineraries && o.itineraries[1], carriers);
      var codes = []
        .concat(out ? out.carrierCodes : [])
        .concat(ret ? ret.carrierCodes : []);
      return {
        price: parseFloat(o.price && o.price.grandTotal) || 0,
        currency: (o.price && o.price.currency) || 'USD',
        outbound: out,
        inbound: ret,
        isElal: codes.length > 0 && codes.every(function (c) { return c === 'LY'; }),
        seatsLeft: o.numberOfBookableSeats
      };
    }).sort(function (a, b) { return a.price - b.price; });
  }

  /** Normalize GET /v1/reference-data/locations/hotels/by-city response. */
  function parseHotelList(json) {
    if (!json || !Array.isArray(json.data)) return [];
    return json.data.map(function (h) {
      return {
        hotelId: h.hotelId,
        name: h.name,
        distanceKm: h.distance && h.distance.value != null ? h.distance.value : null
      };
    });
  }

  /** Normalize GET /v3/shopping/hotel-offers; merge names/distances from the list. */
  function parseHotelOffers(json, hotelList) {
    if (!json || !Array.isArray(json.data)) return [];
    var byId = {};
    (hotelList || []).forEach(function (h) { byId[h.hotelId] = h; });
    return json.data
      .filter(function (d) { return d.offers && d.offers.length; })
      .map(function (d) {
        var offer = d.offers[0];
        var meta = byId[d.hotel && d.hotel.hotelId] || {};
        return {
          name: (d.hotel && d.hotel.name) || meta.name || '',
          price: parseFloat(offer.price && offer.price.total) || 0,
          currency: (offer.price && offer.price.currency) || 'USD',
          distanceKm: meta.distanceKm != null ? meta.distanceKm : null
        };
      })
      .sort(function (a, b) { return a.price - b.price; });
  }

  function qs(params) {
    return Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
  }

  /* ---------- runtime (browser) ---------- */

  var tokenCache = { token: null, exp: 0 };

  function getToken(creds) {
    if (tokenCache.token && Date.now() < tokenCache.exp - 60000) {
      return Promise.resolve(tokenCache.token);
    }
    return fetch(BASE + '/v1/security/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials&client_id=' + encodeURIComponent(creds.apiKey) +
            '&client_secret=' + encodeURIComponent(creds.apiSecret)
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status === 401 ? 'BAD_CREDENTIALS' : 'TOKEN_HTTP_' + r.status);
      return r.json();
    }).then(function (j) {
      tokenCache.token = j.access_token;
      tokenCache.exp = Date.now() + (j.expires_in || 1799) * 1000;
      return tokenCache.token;
    });
  }

  function apiGet(path, params, creds) {
    return getToken(creds).then(function (token) {
      return fetch(BASE + path + '?' + qs(params), {
        headers: { Authorization: 'Bearer ' + token }
      });
    }).then(function (r) {
      if (r.status === 429) throw new Error('RATE_LIMIT');
      if (!r.ok) throw new Error('HTTP_' + r.status);
      return r.json();
    });
  }

  function searchFlights(trip, creds) {
    return apiGet('/v2/shopping/flight-offers', buildFlightParams(trip), creds)
      .then(parseFlightOffers);
  }

  function searchHotels(trip, creds) {
    var listParams = {
      cityCode: cityCode(trip.destAirportCode || trip.destinationCity),
      ratings: String(trip.hotelStars || 5),
      radius: '30',
      radiusUnit: 'KM'
    };
    return apiGet('/v1/reference-data/locations/hotels/by-city', listParams, creds)
      .then(function (listJson) {
        var hotels = parseHotelList(listJson);
        if (!hotels.length) return [];
        var ids = hotels.slice(0, 20).map(function (h) { return h.hotelId; }).join(',');
        var offerParams = {
          hotelIds: ids,
          adults: String(Math.max(1, parseInt(trip.travelers, 10) || 1)),
          checkInDate: trip.startDate,
          checkOutDate: trip.endDate,
          currency: 'USD',
          bestRateOnly: 'true'
        };
        return apiGet('/v3/shopping/hotel-offers', offerParams, creds)
          .then(function (offersJson) { return parseHotelOffers(offersJson, hotels); });
      });
  }

  return {
    buildFlightParams: buildFlightParams,
    parseFlightOffers: parseFlightOffers,
    parseHotelList: parseHotelList,
    parseHotelOffers: parseHotelOffers,
    cityCode: cityCode,
    searchFlights: searchFlights,
    searchHotels: searchHotels,
    _qs: qs
  };
});
