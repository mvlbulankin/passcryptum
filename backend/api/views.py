from datetime import datetime
import base64

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
# from drf_spectacular.utils import extend_schema, OpenApiResponse, OpenApiParameter
# from drf_spectacular.types import OpenApiTypes
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError

from .models import UserServices
from .serializers import UserServicesSerializer, ServicesSerializer


class UserServicesView(APIView):
    # @extend_schema(
    #     summary="Upload user services",
    #     description="Upload user services",
    #     request=UserServicesSerializer,
    #     responses={
    #         200: OpenApiResponse(description="Services have been uploaded to server successfully"),
    #         400: OpenApiResponse(description="Validation error"),
    #         403: OpenApiResponse(description="Public key not found. Please contact the administrator to register your public key"),
    #         500: OpenApiResponse(description="Internal server error"),
    #     },
    #     parameters=[
    #         OpenApiParameter(name='Public-Key', type=OpenApiTypes.STR, description='Public key (Base64 encoded)'),
    #         OpenApiParameter(name='body', type=OpenApiTypes.STR, description='Body (Base64 encoded)'),
    #     ]
    # )
    def post(self, request):
        public_key = request.headers.get('Public-Key')
        encoded_data = request.body
        
        if not public_key:
            return Response({"error": "Public key required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            decoded_public_key = base64.b64decode(public_key)
        except Exception:
            return Response({"error": "Invalid public key format"}, status=status.HTTP_400_BAD_REQUEST)

        if not encoded_data:
            return Response({"error": "Request body is empty"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            decoded_data = base64.b64decode(request.body)
        except Exception:
            return Response({"error": "Invalid request body format"}, status=status.HTTP_400_BAD_REQUEST)

        signature = decoded_data[:64]
        timestamp_bytes = decoded_data[64:68]
        encrypted_services = decoded_data[68:]

        try:
            timestamp = int.from_bytes(timestamp_bytes, byteorder='little')
        except Exception:
            return Response({"error": "Invalid timestamp format"}, status=status.HTTP_400_BAD_REQUEST)

        current_time = int(datetime.now().timestamp())
        if abs(current_time - timestamp) > 300:
            return Response({"error": "Timestamp is too old or too new"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            verify_key = VerifyKey(decoded_public_key)
            verify_key.verify(timestamp_bytes + encrypted_services, signature)
        except BadSignatureError:
            return Response({"error": "Invalid signature"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            user_services = UserServices.objects.filter(public_key=public_key).first()
            
            if not user_services:
                return Response(
                    {"error": "Public key not found. Please contact the administrator to register your public key"},
                    status=status.HTTP_403_FORBIDDEN
                )

            user_services.encrypted_services = base64.b64encode(encrypted_services).decode('ascii')
            user_services.save()
            return Response({"message": "Services uploaded successfully"}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


    # @extend_schema(
    #     summary="Get user services",
    #     description="Get user services",
    #     request=UserServicesSerializer,
    #     responses={
    #         200: OpenApiResponse(response=ServicesSerializer, description="Get user services"),
    #         204: OpenApiResponse(description="Services not found on server"),
    #         400: OpenApiResponse(description="Validation error"),
    #         403: OpenApiResponse(description="Public key not found. Please contact the administrator to register your public key"),
    #         500: OpenApiResponse(description="Internal server error"),
    #     },
    #     parameters=[
    #         OpenApiParameter(name='Public-Key', type=OpenApiTypes.STR, description='Public key (Base64 encoded)'),
    #         OpenApiParameter(name='Timestamp', type=OpenApiTypes.STR, description='Timestamp (Base64 encoded)'),
    #         OpenApiParameter(name='Signature', type=OpenApiTypes.STR, description='Signature (Base64 encoded)'),
    #     ]
    # )
    def get(self, request):
        public_key = request.headers.get('Public-Key')
        encoded_timestamp = request.headers.get('Timestamp')
        encoded_signature = request.headers.get('Signature')

        if not public_key:
            return Response({"error": "Public key is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            decoded_public_key = base64.b64decode(public_key)
        except Exception:
            return Response({"error": "Invalid public key format"}, status=status.HTTP_400_BAD_REQUEST)

        if not encoded_timestamp or not encoded_signature:
            return Response({"error": "Timestamp and Signature are required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            decoded_timestamp = base64.b64decode(encoded_timestamp)
        except Exception:
            return Response({"error": "Invalid timestamp encoding"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            decoded_signature = base64.b64decode(encoded_signature)
        except Exception:
            return Response({"error": "Invalid signature encoding"}, status=status.HTTP_400_BAD_REQUEST)

        current_timestamp = int(datetime.now().timestamp())
        timestamp = int.from_bytes(decoded_timestamp, byteorder='little')
        if abs(current_timestamp - timestamp) > 300:
            return Response({"error": "Timestamp is too old or too new"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            verify_key = VerifyKey(decoded_public_key)
            verify_key.verify(decoded_timestamp, decoded_signature)
        except BadSignatureError:
            return Response({"error": "Invalid signature"}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            user_services = UserServices.objects.filter(public_key=public_key).first()
            
            if not user_services:
                return Response(
                    {"error": "Public key not found. Please contact the administrator to register your public key"},
                    status=status.HTTP_403_FORBIDDEN
                )
            if not user_services.encrypted_services:
                 return Response({"message": "Services not found on server"}, status=status.HTTP_204_NO_CONTENT)
            
            response_data = user_services.encrypted_services
            return Response(response_data, content_type='application/octet-stream', status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


    # @extend_schema(
    #     summary="Delete user services",
    #     description="Delete user services",
    #     request=UserServicesSerializer,
    #     responses={
    #         200: OpenApiResponse(description="Services have been deleted successfully"),
    #         204: OpenApiResponse(description="Services had already been deleted from server"),
    #         400: OpenApiResponse(description="Validation error"),
    #         403: OpenApiResponse(description="Public key not found. Please contact the administrator to register your public key"),
    #         500: OpenApiResponse(description="Internal server error"),
    #     },
    #     parameters=[
    #         OpenApiParameter(name='Public-Key', type=OpenApiTypes.STR, description='Public key (Base64 encoded)'),
    #         OpenApiParameter(name='Timestamp', type=OpenApiTypes.STR, description='Timestamp (Base64 encoded)'),
    #         OpenApiParameter(name='Signature', type=OpenApiTypes.STR, description='Signature (Base64 encoded)'),
    #     ]
    # )
    def delete(self, request):
        public_key = request.headers.get('Public-Key')
        encoded_timestamp = request.headers.get('Timestamp')
        encoded_signature = request.headers.get('Signature')

        if not public_key:
            return Response({"error": "Public key is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            decoded_public_key = base64.b64decode(public_key)
        except Exception:
            return Response({"error": "Invalid public key format"}, status=status.HTTP_400_BAD_REQUEST)

        if not encoded_timestamp or not encoded_signature:
            return Response({"error": "Timestamp and signature are required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            decoded_timestamp = base64.b64decode(encoded_timestamp)
        except Exception:
            return Response({"error": "Invalid timestamp encoding"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            decoded_signature = base64.b64decode(encoded_signature)
        except Exception:
            return Response({"error": "Invalid signature encoding"}, status=status.HTTP_400_BAD_REQUEST)

        current_timestamp = int(datetime.now().timestamp())
        timestamp = int.from_bytes(decoded_timestamp, byteorder='little')
        if abs(current_timestamp - timestamp) > 300:
            return Response({"error": "Timestamp is too old or too new"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            verify_key = VerifyKey(decoded_public_key)
            verify_key.verify(decoded_timestamp, decoded_signature)
        except BadSignatureError:
            return Response({"error": "Invalid signature"}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            user_services = UserServices.objects.filter(public_key=public_key).first()
            
            if not user_services:
                return Response(
                    {"error": "Public key not found. Please contact the administrator to register your public key"},
                    status=status.HTTP_403_FORBIDDEN
                )
            
            if not user_services.encrypted_services:
                return Response({"message": "Services had already been deleted from server"}, status=status.HTTP_204_NO_CONTENT)
            
            user_services.encrypted_services = None
            user_services.save()
            
            return Response({"message": "Services have been deleted successfully"}, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        