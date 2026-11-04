import { WireError } from '../../wire'

/**
 * A WireError mapped onto a caller-defined failure vocabulary.
 *
 * Both PIN Custody and Vault sync report failures as a closed set of reasons,
 * and the mapping from the wire's four kinds to those reasons is the same
 * shape in both: 403 means whatever the operation implies (each caller says
 * which reason that is, because the server answers a bare 403 to several
 * different situations), a transport failure is always "network", and
 * anything else is "unexpected".
 *
 * `generic` is the vocabulary's own member for both the "unexpected" case and
 * a non-wire throw, so one helper covers every exit.
 */
export const fromWireFailure = <Reason extends string>(
  e: unknown,
  options: { forbidden: Reason; network: Reason; unexpected: Reason },
): Reason => {
  if (e instanceof WireError) {
    if (e.kind === 'forbidden') {
      return options.forbidden
    }

    if (e.kind === 'network') {
      return options.network
    }
  }

  return options.unexpected
}
