// External processors renew before this deadline; an expired attempt cannot resume.
// Persistence uses the database clock, not the processor's wall clock.
export const libraryProcessingLeaseSeconds = 300;
