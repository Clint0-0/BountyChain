// Server-side authorisation for confidential report data, derived from ON-CHAIN
// state (not from anything the client claims).
//
// Allowed parties for a submission:
//   researcher       - the wallet that submitted it
//   organization     - owner of the program it belongs to
//   verifier         - a verifier currently assigned to that program
//   dispute_resolver - the platform dispute resolver, only once a dispute exists
async function getSubmissionAccess(chain, submissionId, user) {
  const s = await chain.getSubmission(submissionId);
  if (!s) return { submission: null, roles: [] };
  const roles = [];
  if (s.researcher === user) roles.push("researcher");
  const [program, verifier, resolver, dispute] = await Promise.all([
    chain.getProgram(s.programId),
    chain.isVerifier(s.programId, user),
    chain.disputeResolver(),
    chain.getDispute(submissionId),
  ]);
  if (program && program.owner === user) roles.push("organization");
  if (verifier) roles.push("verifier");
  if (resolver === user && dispute.status !== "None") roles.push("dispute_resolver");
  return { submission: s, program, dispute, roles };
}

module.exports = { getSubmissionAccess };
