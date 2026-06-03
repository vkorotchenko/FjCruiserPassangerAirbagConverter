// =============================================================================
// Vehicle Communication Protocol & Occupant-Classification (OCS) Database
// MongoDB seed script for the FjCruiserPassangerAirbagConverter project.
//
// Usage:
//   mongosh "mongodb://localhost:27017" data/vehicle_protocols.mongo.js
//   -- or, inside a mongosh session --
//   load('data/vehicle_protocols.mongo.js')
//
// Collections created:
//   protocols       - reference table of bus/diagnostic protocols
//   signal_catalog  - canonical occupant signals this project cares about
//   vehicles        - one document PER MODEL GENERATION
//
// Fields left as null / [] are intentionally blank: populate them from
// experimentation (CanHandler::process logs, Canable + CANgaroo captures,
// or K-line sniffing) and set `verified: true` once confirmed on a vehicle.
//
// confidence: project | standard | documented | inferred | unknown
//   (see metadata in data/vehicle_protocols.json for definitions)
// =============================================================================

const DB_NAME = 'fj_airbag';
db = db.getSiblingDB(DB_NAME);

// Fresh load: drop and recreate. Comment these out to append instead.
db.protocols.drop();
db.signal_catalog.drop();
db.vehicles.drop();

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// A blank signal slot, ready to be filled in from experimentation.
function blankSignal(transport) {
  return {
    transport: transport || null, // "can" | "k-line-pid" | "k-line-raw"
    mode: null,                   // OBD service/mode, e.g. "0x01" (k-line PIDs)
    id: null,                     // CAN frame ID or K-line PID
    byteOffset: null,             // byte index inside the payload
    bitMask: null,                // mask within that byte, if applicable
    values: null,                 // { stateName: rawValue, ... }
    source: 'unknown',
    verified: false,
    note: null
  };
}

// A blank occupant-classification block with the three signals this project maps.
function blankOcs(overrides) {
  const base = {
    present: null,                // true/false once known
    ecu: null,                    // name of the module that owns occupant data
    method: null,                 // "weight-sensor" | "capacitive-mat" | "OPDS" | ...
    moduleBus: null,              // which protocols[_id] carries occupant data
    moduleBusConfidence: 'inferred',
    signals: {
      seatbelt_status: blankSignal(),
      passenger_classification: blankSignal(),
      airbag_indicator: blankSignal()
    },
    canFrames: [],                // raw observed frames not yet decoded
    dtcs: [],
    calibration: null
  };
  return Object.assign(base, overrides || {});
}

// -----------------------------------------------------------------------------
// protocols
// -----------------------------------------------------------------------------

db.protocols.insertMany([
  { _id: 'iso9141-2', name: 'ISO 9141-2', family: 'K-line', busSpeedKbps: 10.4,
    init: '5-baud slow init (addr 0x33)', obdPins: [7, 15],
    physical: 'Single-wire 12V; logic-level shifter (e.g. MC33290) required for an MCU',
    typicalRegion: 'Older European & Asian vehicles; Asian body modules', usedByThisProject: true },
  { _id: 'iso14230-4-kwp-slow', name: 'ISO 14230-4 (KWP2000)', family: 'K-line', busSpeedKbps: 10.4,
    init: '5-baud slow init', obdPins: [7, 15], typicalRegion: 'European & Asian, late 1990s-2000s' },
  { _id: 'iso14230-4-kwp-fast', name: 'ISO 14230-4 (KWP2000)', family: 'K-line', busSpeedKbps: 10.4,
    init: 'Fast init (wake-up pulse)', obdPins: [7, 15], typicalRegion: 'European & Asian, 2000s' },
  { _id: 'j1850-pwm', name: 'SAE J1850 PWM', family: 'J1850', busSpeedKbps: 41.6,
    obdPins: [2, 10], typicalRegion: 'Ford (North America), 1996-2008' },
  { _id: 'j1850-vpw', name: 'SAE J1850 VPW', family: 'J1850', busSpeedKbps: 10.4,
    obdPins: [2], typicalRegion: 'GM & Chrysler (North America), 1996-2008' },
  { _id: 'iso15765-4-can-11-500', name: 'ISO 15765-4 CAN (11-bit, 500 kbps)', family: 'CAN',
    busSpeedKbps: 500, addressing: '11-bit', functionalRequestId: '0x7DF',
    physicalRequestIdRange: '0x7E0-0x7E7', ecuResponseIdRange: '0x7E8-0x7EF', obdPins: [6, 14],
    typicalRegion: 'Most vehicles 2008+ (mandatory in North America from 2008)' },
  { _id: 'iso15765-4-can-29-500', name: 'ISO 15765-4 CAN (29-bit, 500 kbps)', family: 'CAN',
    busSpeedKbps: 500, addressing: '29-bit', functionalRequestId: '0x18DB33F1',
    ecuResponseIdRange: '0x18DAF1xx', obdPins: [6, 14], typicalRegion: 'Some 2008+ (GM/Chrysler)' },
  { _id: 'iso15765-4-can-11-250', name: 'ISO 15765-4 CAN (11-bit, 250 kbps)', family: 'CAN',
    busSpeedKbps: 250, addressing: '11-bit', functionalRequestId: '0x7DF',
    ecuResponseIdRange: '0x7E8-0x7EF', obdPins: [6, 14], typicalRegion: 'Some medium-duty / early CAN' }
]);

// -----------------------------------------------------------------------------
// signal_catalog  (canonical states; per-vehicle docs supply the raw IDs/values)
// -----------------------------------------------------------------------------

db.signal_catalog.insertMany([
  { _id: 'seatbelt_status', meaning: 'Front passenger seat belt buckle state',
    states: { unbuckled: 0, buckled: 1 } },
  { _id: 'passenger_classification', meaning: 'Occupant weight category gating the passenger airbag and chime',
    states: { empty: 0, child: 1, adult: 2 },
    behavior: {
      empty: 'Passenger airbag OFF, no chime',
      child: 'Passenger airbag OFF/suppressed, chime suppressed (occupant under ~30 kg)',
      adult: 'Passenger airbag ON, chime active (occupant over ~30 kg threshold)'
    } },
  { _id: 'airbag_indicator', meaning: 'PASSENGER AIRBAG ON/OFF indicator lamp request',
    states: { off: 0, on: 1 } }
]);

// -----------------------------------------------------------------------------
// vehicles  (one document per model generation)
// -----------------------------------------------------------------------------

db.vehicles.insertMany([

  // ===== Toyota / Lexus =====
  {
    _id: 'toyota-fj-cruiser-gen1',
    make: 'Toyota', model: 'FJ Cruiser', generation: '1', chassisCode: 'GSJ15',
    yearStart: 2007, yearEnd: 2014, region: ['North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso15765-4-can-11-500', confidence: 'documented',
      note: 'OBD-II/DLC3 is CAN. The OCS ECU itself talks over a legacy single-wire DIA line (ISO 9141-2) - that is the bus this project taps.' },
    occupantClassification: {
      present: true,
      ecu: 'Occupant Classification ECU (OCS)',
      method: 'weight-sensor (4 corner sensors) + buckle switch',
      moduleBus: 'iso9141-2', moduleBusConfidence: 'project',
      signals: {
        seatbelt_status: { transport: 'k-line-pid', mode: '0x01', id: '0x60', byteOffset: 0, bitMask: null,
          values: { unbuckled: 0, buckled: 1 }, source: 'project', verified: false,
          note: 'PID_SEATBELT_STATUS - src/k_line.h' },
        passenger_classification: { transport: 'k-line-pid', mode: '0x01', id: '0x61', byteOffset: 0, bitMask: null,
          values: { none: 0, child: 1, adult: 2 }, source: 'project', verified: false,
          note: 'PID_PASSENGER_TYPE - src/k_line.h' },
        airbag_indicator: blankSignal()
      },
      canFrames: [
        { id: '0x265', label: 'OCS_CAN_ID_1', source: 'project', decoded: false, note: 'src/config.h; payload layout not yet decoded' },
        { id: '0x453', label: 'OCS_CAN_ID_2', source: 'project', decoded: false, note: 'src/config.h; payload layout not yet decoded' }
      ],
      dtcs: [
        { code: 'B1650/32', meaning: 'Occupant Classification System Malfunction', source: 'documented' },
        { code: 'B0105', meaning: 'Front passenger occupant sensor / wiring fault', source: 'documented' },
        { code: 'B0130', meaning: 'Front passenger occupant sensor / wiring fault', source: 'documented' },
        { code: 'B1145', meaning: 'Front passenger occupant sensor / wiring fault', source: 'documented' }
      ],
      calibration: 'Zero-point calibration required when the passenger seat is removed/installed or items added (hand-held tester via DLC3).'
    },
    verified: false
  },
  { _id: 'toyota-4runner-n210', make: 'Toyota', model: '4Runner', generation: '4 (N210)', chassisCode: 'GRN21x/UZN21x',
    yearStart: 2003, yearEnd: 2009, region: ['North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso9141-2', confidence: 'inferred', note: '2008+ migrate to CAN.' },
    occupantClassification: blankOcs({ present: true, ecu: 'Occupant Classification ECU (OCS)', method: 'weight-sensor', moduleBus: 'iso9141-2' }),
    verified: false },
  { _id: 'toyota-4runner-n280', make: 'Toyota', model: '4Runner', generation: '5 (N280)', chassisCode: 'GRN28x',
    yearStart: 2010, yearEnd: 2024, region: ['North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso15765-4-can-11-500', confidence: 'standard' },
    occupantClassification: blankOcs({ present: true, ecu: 'Occupant Classification ECU (OCS)', method: 'weight-sensor', moduleBus: 'iso15765-4-can-11-500' }),
    verified: false },
  { _id: 'toyota-tacoma-n220', make: 'Toyota', model: 'Tacoma', generation: '2 (N220)', chassisCode: 'GRN/TRN22x',
    yearStart: 2005, yearEnd: 2015, region: ['North America'],
    obdPort: { diagnosticProtocol: 'iso9141-2', confidence: 'inferred', note: '2008+ CAN at OBD-II port.' },
    occupantClassification: blankOcs({ present: true, ecu: 'Occupant Classification ECU (OCS)', method: 'weight-sensor', moduleBus: 'iso9141-2',
      dtcs: [{ code: 'B1650', meaning: 'Occupant Classification System Malfunction', source: 'documented' }] }),
    verified: false },
  { _id: 'toyota-tacoma-n300', make: 'Toyota', model: 'Tacoma', generation: '3 (N300)', chassisCode: 'GRN30x',
    yearStart: 2016, yearEnd: 2023, region: ['North America'],
    obdPort: { diagnosticProtocol: 'iso15765-4-can-11-500', confidence: 'standard' },
    occupantClassification: blankOcs({ present: true, ecu: 'Occupant Classification ECU (OCS)', method: 'weight-sensor', moduleBus: 'iso15765-4-can-11-500' }),
    verified: false },
  { _id: 'toyota-tundra-xk50', make: 'Toyota', model: 'Tundra', generation: '2 (XK50)', chassisCode: 'USK5x',
    yearStart: 2007, yearEnd: 2021, region: ['North America'],
    obdPort: { diagnosticProtocol: 'iso15765-4-can-11-500', confidence: 'standard' },
    occupantClassification: blankOcs({ present: true, ecu: 'Occupant Classification ECU (OCS)', method: 'weight-sensor', moduleBus: 'iso15765-4-can-11-500' }),
    verified: false },
  { _id: 'toyota-camry-xv30', make: 'Toyota', model: 'Camry', generation: '5 (XV30)', chassisCode: 'XV30',
    yearStart: 2002, yearEnd: 2006, region: ['North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso9141-2', confidence: 'documented' },
    occupantClassification: blankOcs({ present: true, ecu: 'Occupant Classification ECU (OCS)', method: 'weight-sensor', moduleBus: 'iso9141-2' }),
    verified: false },
  { _id: 'toyota-camry-xv40', make: 'Toyota', model: 'Camry', generation: '6 (XV40)', chassisCode: 'XV40',
    yearStart: 2007, yearEnd: 2011, region: ['North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso15765-4-can-11-500', confidence: 'standard' },
    occupantClassification: blankOcs({ present: true, ecu: 'Occupant Classification ECU (OCS)', method: 'weight-sensor', moduleBus: 'iso15765-4-can-11-500' }),
    verified: false },
  { _id: 'toyota-camry-xv50', make: 'Toyota', model: 'Camry', generation: '7 (XV50)', chassisCode: 'XV50',
    yearStart: 2012, yearEnd: 2017, region: ['North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso15765-4-can-11-500', confidence: 'standard' },
    occupantClassification: blankOcs({ present: true, ecu: 'Occupant Classification ECU (OCS)', method: 'weight-sensor', moduleBus: 'iso15765-4-can-11-500' }),
    verified: false },
  { _id: 'toyota-corolla-e130', make: 'Toyota', model: 'Corolla', generation: '9 (E130)', chassisCode: 'E130',
    yearStart: 2003, yearEnd: 2008, region: ['North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso9141-2', confidence: 'documented', note: '2009+ CAN.' },
    occupantClassification: blankOcs({ present: true, method: 'weight-sensor', moduleBus: 'iso9141-2' }),
    verified: false },
  { _id: 'toyota-corolla-e140', make: 'Toyota', model: 'Corolla', generation: '10 (E140/E150)', chassisCode: 'E140',
    yearStart: 2009, yearEnd: 2013, region: ['North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso15765-4-can-11-500', confidence: 'standard' },
    occupantClassification: blankOcs({ present: true, method: 'weight-sensor', moduleBus: 'iso15765-4-can-11-500' }),
    verified: false },
  { _id: 'toyota-land-cruiser-j100', make: 'Toyota', model: 'Land Cruiser', generation: '100 (J100)', chassisCode: 'J100',
    yearStart: 1998, yearEnd: 2007, region: ['North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso9141-2', confidence: 'inferred', note: '2008+ (J200) CAN.' },
    occupantClassification: blankOcs({ present: true, ecu: 'Occupant Classification ECU (OCS)', method: 'weight-sensor', moduleBus: 'iso9141-2' }),
    verified: false },
  { _id: 'lexus-gx470-j120', make: 'Lexus', model: 'GX470', generation: '1 (J120)', chassisCode: 'J120',
    yearStart: 2003, yearEnd: 2009, region: ['North America'],
    obdPort: { diagnosticProtocol: 'iso9141-2', confidence: 'inferred', note: 'Shares OCS architecture with Toyota body-on-frame platforms.' },
    occupantClassification: blankOcs({ present: true, ecu: 'Occupant Classification ECU (OCS)', method: 'weight-sensor', moduleBus: 'iso9141-2' }),
    verified: false },

  // ===== Ford =====
  {
    _id: 'ford-mustang-s197',
    make: 'Ford', model: 'Mustang', generation: '5 (S197)', chassisCode: 'S197',
    yearStart: 2005, yearEnd: 2014, region: ['North America'],
    obdPort: { diagnosticProtocol: 'j1850-pwm', confidence: 'inferred',
      note: 'Pre-2008 S197 use Ford J1850 PWM at the OBD-II port; 2008+ are CAN. Restraint modules use internal HS/MS-CAN.' },
    occupantClassification: blankOcs({ present: true, ecu: 'Restraint Control Module (RCM) + occupant classification sensor',
      method: 'weight-sensor', moduleBus: 'iso15765-4-can-11-500',
      calibration: 'DONOR SEATS for this project - capture the seat CAN output and map frames to empty/child/adult.' }),
    notes: 'Donor seats for FjCruiserPassangerAirbagConverter. Capture via CanHandler::process or Canable + CANgaroo.',
    verified: false
  },
  { _id: 'ford-mustang-s550', make: 'Ford', model: 'Mustang', generation: '6 (S550)', chassisCode: 'S550',
    yearStart: 2015, yearEnd: 2023, region: ['North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso15765-4-can-11-500', confidence: 'standard' },
    occupantClassification: blankOcs({ present: true, ecu: 'Restraint Control Module (RCM)', method: 'weight-sensor', moduleBus: 'iso15765-4-can-11-500' }),
    verified: false },
  { _id: 'ford-f150-p221', make: 'Ford', model: 'F-150', generation: '11 (P221)', chassisCode: 'P221',
    yearStart: 2004, yearEnd: 2008, region: ['North America'],
    obdPort: { diagnosticProtocol: 'j1850-pwm', confidence: 'documented', note: 'Ford NA used J1850 PWM until ~2008.' },
    occupantClassification: blankOcs({ present: true, ecu: 'Restraint Control Module (RCM)', method: 'weight-sensor', moduleBus: 'iso15765-4-can-11-500' }),
    verified: false },
  { _id: 'ford-f150-p415', make: 'Ford', model: 'F-150', generation: '12 (P415)', chassisCode: 'P415',
    yearStart: 2009, yearEnd: 2014, region: ['North America'],
    obdPort: { diagnosticProtocol: 'iso15765-4-can-11-500', confidence: 'standard' },
    occupantClassification: blankOcs({ present: true, ecu: 'Restraint Control Module (RCM)', method: 'weight-sensor', moduleBus: 'iso15765-4-can-11-500' }),
    verified: false },

  // ===== GM =====
  { _id: 'chevrolet-silverado-gmt800', make: 'Chevrolet', model: 'Silverado 1500', generation: '1 (GMT800)', chassisCode: 'GMT800',
    yearStart: 1999, yearEnd: 2007, region: ['North America'],
    obdPort: { diagnosticProtocol: 'j1850-vpw', confidence: 'documented', note: 'GM Class 2 (J1850 VPW) until the 2008 CAN mandate.' },
    occupantClassification: blankOcs({ present: true, ecu: 'Sensing & Diagnostic Module (SDM)', method: 'Passenger Presence System (PPS) / weight-sensor', moduleBus: 'j1850-vpw' }),
    verified: false },
  { _id: 'chevrolet-silverado-gmt900', make: 'Chevrolet', model: 'Silverado 1500', generation: '2 (GMT900)', chassisCode: 'GMT900',
    yearStart: 2007, yearEnd: 2013, region: ['North America'],
    obdPort: { diagnosticProtocol: 'iso15765-4-can-11-500', confidence: 'standard' },
    occupantClassification: blankOcs({ present: true, ecu: 'Sensing & Diagnostic Module (SDM)', method: 'Passenger Presence System (PPS)', moduleBus: 'iso15765-4-can-11-500' }),
    verified: false },

  // ===== Honda =====
  { _id: 'honda-accord-7gen', make: 'Honda', model: 'Accord', generation: '7 (CM/CL)', chassisCode: 'CM/CL',
    yearStart: 2003, yearEnd: 2007, region: ['North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso9141-2', confidence: 'documented', note: '2008+ CAN.' },
    occupantClassification: blankOcs({ present: true, ecu: 'SRS unit + Occupant Position Detection System (OPDS)', method: 'OPDS capacitive seat-back sensor', moduleBus: 'iso9141-2' }),
    verified: false },
  { _id: 'honda-accord-8gen', make: 'Honda', model: 'Accord', generation: '8 (CP/CS)', chassisCode: 'CP/CS',
    yearStart: 2008, yearEnd: 2012, region: ['North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso15765-4-can-11-500', confidence: 'standard' },
    occupantClassification: blankOcs({ present: true, ecu: 'SRS unit + OPDS', method: 'OPDS capacitive sensor', moduleBus: 'iso15765-4-can-11-500' }),
    verified: false },
  { _id: 'honda-civic-8gen', make: 'Honda', model: 'Civic', generation: '8 (FA/FG/FD)', chassisCode: 'FA/FG/FD',
    yearStart: 2006, yearEnd: 2011, region: ['North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso15765-4-can-11-500', confidence: 'inferred' },
    occupantClassification: blankOcs({ present: true, ecu: 'SRS unit + OPDS', method: 'OPDS capacitive sensor', moduleBus: 'iso15765-4-can-11-500' }),
    verified: false },

  // ===== Nissan =====
  { _id: 'nissan-altima-l31', make: 'Nissan', model: 'Altima', generation: '3 (L31)', chassisCode: 'L31',
    yearStart: 2002, yearEnd: 2006, region: ['North America'],
    obdPort: { diagnosticProtocol: 'iso9141-2', confidence: 'documented', note: '2007+ CAN.' },
    occupantClassification: blankOcs({ present: true, ecu: 'Occupant Classification System unit', method: 'weight-sensor', moduleBus: 'iso9141-2' }),
    verified: false },
  { _id: 'nissan-altima-l32', make: 'Nissan', model: 'Altima', generation: '4 (L32)', chassisCode: 'L32',
    yearStart: 2007, yearEnd: 2012, region: ['North America'],
    obdPort: { diagnosticProtocol: 'iso15765-4-can-11-500', confidence: 'standard' },
    occupantClassification: blankOcs({ present: true, ecu: 'Occupant Classification System unit', method: 'weight-sensor', moduleBus: 'iso15765-4-can-11-500' }),
    verified: false },

  // ===== Subaru =====
  { _id: 'subaru-outback-bp', make: 'Subaru', model: 'Outback / Legacy', generation: '4 (BP/BL)', chassisCode: 'BP/BL',
    yearStart: 2005, yearEnd: 2009, region: ['North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso9141-2', confidence: 'inferred', note: 'Mid-2000s Subaru used ISO 9141-2 / KWP; later CAN.' },
    occupantClassification: blankOcs({ present: true, ecu: 'Occupant Detection System', method: 'weight-sensor', moduleBus: 'iso9141-2' }),
    verified: false },

  // ===== Volkswagen =====
  { _id: 'vw-golf-mk5', make: 'Volkswagen', model: 'Golf / Jetta', generation: 'Mk5 (1K)', chassisCode: '1K',
    yearStart: 2005, yearEnd: 2009, region: ['Europe', 'North America'],
    obdPort: { diagnosticProtocol: 'iso14230-4-kwp-fast', confidence: 'documented', note: 'VAG KWP2000; many 2008+ models moved to CAN/UDS.' },
    occupantClassification: blankOcs({ present: true, ecu: 'Airbag control unit + seat occupancy mat', method: 'capacitive/weight occupancy mat', moduleBus: 'iso14230-4-kwp-fast' }),
    verified: false },

  // ===== BMW =====
  { _id: 'bmw-3series-e46', make: 'BMW', model: '3 Series', generation: 'E46', chassisCode: 'E46',
    yearStart: 1998, yearEnd: 2006, region: ['Europe', 'North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso9141-2', confidence: 'documented', note: 'BMW K-line before CAN transition (~2001-2004 on newer platforms).' },
    occupantClassification: blankOcs({ present: true, ecu: 'MRS (Multiple Restraint System) + seat occupancy detection (BST/SBE mat)', method: 'occupancy/weight mat', moduleBus: 'iso9141-2' }),
    verified: false },
  { _id: 'bmw-5series-e60', make: 'BMW', model: '5 Series', generation: 'E60', chassisCode: 'E60',
    yearStart: 2004, yearEnd: 2010, region: ['Europe', 'North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso15765-4-can-11-500', confidence: 'documented', note: 'Early CAN adopter.' },
    occupantClassification: blankOcs({ present: true, ecu: 'MRS + seat occupancy detection', method: 'occupancy mat', moduleBus: 'iso15765-4-can-11-500' }),
    verified: false },

  // ===== Mercedes-Benz =====
  { _id: 'mercedes-cclass-w203', make: 'Mercedes-Benz', model: 'C-Class', generation: 'W203', chassisCode: 'W203',
    yearStart: 2001, yearEnd: 2007, region: ['Europe', 'North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso9141-2', confidence: 'inferred', note: 'Early W203 K-line; facelift moves toward CAN.' },
    occupantClassification: blankOcs({ present: true, ecu: 'Airbag control module + AOS (Automatic Occupant Sensing)', method: 'weight-sensor mat', moduleBus: 'iso9141-2' }),
    verified: false },

  // ===== Chrysler =====
  { _id: 'chrysler-300-lx', make: 'Chrysler', model: '300', generation: '1 (LX)', chassisCode: 'LX',
    yearStart: 2005, yearEnd: 2010, region: ['North America'],
    obdPort: { diagnosticProtocol: 'j1850-vpw', confidence: 'inferred', note: 'Chrysler J1850 VPW pre-2008, then CAN.' },
    occupantClassification: blankOcs({ present: true, ecu: 'Occupant Restraint Controller (ORC) + occupant classification module', method: 'weight-sensor', moduleBus: 'j1850-vpw' }),
    verified: false },

  // ===== Hyundai =====
  { _id: 'hyundai-sonata-nf', make: 'Hyundai', model: 'Sonata', generation: '5 (NF)', chassisCode: 'NF',
    yearStart: 2006, yearEnd: 2010, region: ['North America', 'Global'],
    obdPort: { diagnosticProtocol: 'iso15765-4-can-11-500', confidence: 'inferred', note: 'Earliest 2006 may be KWP/K-line; majority CAN.' },
    occupantClassification: blankOcs({ present: true, ecu: 'SRSCM + Passenger Occupant Detection System (PODS)', method: 'weight-sensor (bladder/strain gauge)', moduleBus: 'iso15765-4-can-11-500' }),
    verified: false }
]);

// -----------------------------------------------------------------------------
// Indexes
// -----------------------------------------------------------------------------

db.vehicles.createIndex({ make: 1, model: 1, yearStart: 1 });
db.vehicles.createIndex({ 'obdPort.diagnosticProtocol': 1 });
db.vehicles.createIndex({ 'occupantClassification.moduleBus': 1 });
db.vehicles.createIndex({ verified: 1 });

// -----------------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------------

print('Seeded database: ' + DB_NAME);
print('  protocols:      ' + db.protocols.countDocuments());
print('  signal_catalog: ' + db.signal_catalog.countDocuments());
print('  vehicles:       ' + db.vehicles.countDocuments() + ' (model generations)');
print('  verified:       ' + db.vehicles.countDocuments({ verified: true }));
