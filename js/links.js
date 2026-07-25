/**
 * TravelLinks - smart deep-link builders for flight & hotel searches.
 *
 * Works in both the browser (window.TravelLinks) and Node/Jest (module.exports).
 * All builders take a "trip" object:
 * {
 *   originAirport: 'TLV',
 *   destAirportCode: 'CDG' | '' ,
 *   destinationCity: 'Paris',
 *   destinationCountry: 'France',
 *   startDate: 'YYYY-MM-DD',
 *   endDate: 'YYYY-MM-DD',
 *   travelers: 1,
 *   cabin: 'economy' | 'premium_economy' | 'business' | 'first',
 *   directOnly: true|false,
 *   type: 'business' | 'private',
 *   venueName: '', venueAddress: ''
 * }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TravelLinks = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CABIN_LABELS = {
    economy: { google: 'economy class', kayak: 'economy', skyscanner: 'economy' },
    premium_economy: { google: 'premium economy class', kayak: 'premium', skyscanner: 'premiumeconomy' },
    business: { google: 'business class', kayak: 'business', skyscanner: 'business' },
    first: { google: 'first class', kayak: 'first', skyscanner: 'first' }
  };

  function cabinFor(trip) {
    return CABIN_LABELS[trip.cabin] || CABIN_LABELS.economy;
  }

  function enc(s) {
    return encodeURIComponent(String(s == null ? '' : s).trim());
  }

  // '2026-08-01' -> '260801' (Skyscanner date format)
  function toYYMMDD(isoDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate || '')) return null;
    return isoDate.slice(2).replace(/-/g, '');
  }

  function validIso(d) {
    return /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  }

  function hasAirports(trip) {
    return /^[A-Za-z]{3}$/.test(trip.originAirport || '') &&
           /^[A-Za-z]{3}$/.test(trip.destAirportCode || '');
  }

  // preferred-airline registry: IATA code -> display name used in link queries
  const AIRLINES = { LY: 'El Al' };

  function preferredAirlineName(trip) {
    return AIRLINES[(trip.preferredAirline || '').toUpperCase()] || null;
  }

  /** Natural-language query link - always available, no airport code needed. */
  function googleFlights(trip) {
    if (!validIso(trip.startDate) || !validIso(trip.endDate)) return null;
    const from = hasAirports(trip) ? trip.originAirport.toUpperCase() : (trip.originAirport || 'TLV');
    const to = hasAirports(trip) ? trip.destAirportCode.toUpperCase() : trip.destinationCity;
    if (!to) return null;
    const parts = [
      'flights from ' + from + ' to ' + to,
      'on ' + trip.startDate + ' through ' + trip.endDate,
      cabinFor(trip).google
    ];
    if (trip.directOnly) parts.push('nonstop');
    const airline = preferredAirlineName(trip);
    if (airline) parts.push('with ' + airline);
    return 'https://www.google.com/travel/flights?q=' + enc(parts.join(' ')) + '&curr=USD';
  }

  function skyscanner(trip) {
    if (!hasAirports(trip)) return null;
    const d1 = toYYMMDD(trip.startDate);
    const d2 = toYYMMDD(trip.endDate);
    if (!d1 || !d2) return null;
    const adults = Math.max(1, parseInt(trip.travelers, 10) || 1);
    let url = 'https://www.skyscanner.co.il/transport/flights/' +
      trip.originAirport.toLowerCase() + '/' + trip.destAirportCode.toLowerCase() +
      '/' + d1 + '/' + d2 + '/?adultsv2=' + adults +
      '&cabinclass=' + cabinFor(trip).skyscanner;
    if (trip.directOnly) url += '&preferdirects=true';
    return url;
  }

  function kayak(trip) {
    if (!hasAirports(trip)) return null;
    if (!validIso(trip.startDate) || !validIso(trip.endDate)) return null;
    const adults = Math.max(1, parseInt(trip.travelers, 10) || 1);
    let url = 'https://www.kayak.com/flights/' +
      trip.originAirport.toUpperCase() + '-' + trip.destAirportCode.toUpperCase() +
      '/' + trip.startDate + '/' + trip.endDate;
    url += '/' + cabinFor(trip).kayak;
    if (adults > 1) url += '/' + adults + 'adults';
    url += '?sort=price_a'; // cheapest first - price is king
    const fs = [];
    if (trip.directOnly) fs.push('stops=0');
    if (preferredAirlineName(trip)) fs.push('airlines=' + trip.preferredAirline.toUpperCase());
    if (fs.length) url += '&fs=' + enc(fs.join(';'));
    return url;
  }

  /** Direct link to the preferred airline's own site (user logs in there). */
  function airlineSite(trip) {
    if ((trip.preferredAirline || '').toUpperCase() === 'LY') {
      return 'https://www.elal.com/';
    }
    return null;
  }

  /**
   * Where should the hotel search be centered?
   * Business trip: near the venue/exhibition. Private trip: city center.
   */
  function hotelSearchQuery(trip) {
    const city = (trip.destinationCity || '').trim();
    const country = (trip.destinationCountry || '').trim();
    if (trip.type === 'business' && ((trip.venueAddress || '').trim() || (trip.venueName || '').trim())) {
      const venue = (trip.venueAddress || '').trim() || (trip.venueName || '').trim();
      // append the city only if the venue string doesn't already mention it
      const hasCity = city && venue.toLowerCase().indexOf(city.toLowerCase()) !== -1;
      return venue + (city && !hasCity ? ', ' + city : '');
    }
    if (!city) return '';
    return city + ' city center' + (country ? ', ' + country : '');
  }

  /** Booking.com search, pre-filtered to 5-star hotels (nflt=class=5). */
  function booking(trip, opts) {
    const q = hotelSearchQuery(trip);
    if (!q) return null;
    const stars = (opts && opts.stars) || 5;
    const adults = Math.max(1, parseInt(trip.travelers, 10) || 1);
    let url = 'https://www.booking.com/searchresults.he.il.html?ss=' + enc(q) +
      '&group_adults=' + adults + '&no_rooms=1&group_children=0' +
      '&nflt=' + enc('class=' + stars);
    if (validIso(trip.startDate)) url += '&checkin=' + trip.startDate;
    if (validIso(trip.endDate)) url += '&checkout=' + trip.endDate;
    return url;
  }

  /** Google Hotels natural-language search. */
  function googleHotels(trip, opts) {
    const q = hotelSearchQuery(trip);
    if (!q) return null;
    const stars = (opts && opts.stars) || 5;
    let text = stars + ' star hotels near ' + q;
    if (validIso(trip.startDate) && validIso(trip.endDate)) {
      text += ' check in ' + trip.startDate + ' check out ' + trip.endDate;
    }
    return 'https://www.google.com/travel/search?q=' + enc(text);
  }

  /** All links for a trip, nulls filtered out by the caller. */
  function allLinks(trip) {
    return {
      flights: [
        { id: 'airline-site', label: 'אתר אל על', url: airlineSite(trip) },
        { id: 'google-flights', label: 'Google Flights', url: googleFlights(trip) },
        { id: 'skyscanner', label: 'Skyscanner', url: skyscanner(trip) },
        { id: 'kayak', label: 'Kayak', url: kayak(trip) }
      ].filter(function (l) { return !!l.url; }),
      hotels: [
        { id: 'booking', label: 'Booking.com', url: booking(trip) },
        { id: 'google-hotels', label: 'Google Hotels', url: googleHotels(trip) }
      ].filter(function (l) { return !!l.url; })
    };
  }

  return {
    googleFlights: googleFlights,
    skyscanner: skyscanner,
    kayak: kayak,
    airlineSite: airlineSite,
    booking: booking,
    googleHotels: googleHotels,
    hotelSearchQuery: hotelSearchQuery,
    allLinks: allLinks,
    _toYYMMDD: toYYMMDD
  };
});
