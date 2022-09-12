import type { Socket } from 'socket.io'

import type { ClientId } from '../../types'

export type UserId = string | ClientId
export type GetUserId = (socket: Omit<Socket, 'userId'>) => UserId | Error
